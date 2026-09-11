use crate::{
    domain::{
        attachment::{
            attachment_month_dir, is_attachment_relative, max_attachment_bytes_for_extension,
            mime_from_extension, resolve_attachment_extension, sanitize_attachment_file_name,
            unique_file_name, ATTACHMENTS_DIR,
        },
        cloud_sync::{is_conflict_sidecar, is_note_relative, is_writable_sync_path, FileIdentity},
        folder_of,
        path::{
            create_parent_dirs, is_supported_note, normalize_root, resolve_existing_attachment,
            resolve_existing_note, resolve_new_attachment, resolve_new_note, should_skip_dir,
            to_relative_path, validate_nearest_existing_parent, validate_note_extension,
            validate_relative_path,
        },
        AppError, AppResult, AttachmentFile, NoteIdentity, TrashEntry, TrashManifest,
    },
    infrastructure::atomic::{atomic_copy, atomic_write},
    infrastructure::index::DirCacheRow,
};
use std::{
    collections::HashMap,
    fs, io,
    path::{Component, Path, PathBuf},
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
    time::SystemTime,
};

#[derive(Debug, Clone)]
pub struct LocalFileSystem {
    pub walk_dirs: Arc<AtomicUsize>,
    pub attachment_walk_dirs: Arc<AtomicUsize>,
}

impl Default for LocalFileSystem {
    fn default() -> Self {
        Self::new()
    }
}

impl LocalFileSystem {
    pub fn new() -> Self {
        Self {
            walk_dirs: Arc::new(AtomicUsize::new(0)),
            attachment_walk_dirs: Arc::new(AtomicUsize::new(0)),
        }
    }

    #[cfg(test)]
    pub fn scan_workspace(&self, root: &str) -> AppResult<Vec<NoteIdentity>> {
        Ok(self.walk_workspace(root, &HashMap::new(), &[])?.notes)
    }

    pub fn walk_workspace(
        &self,
        root: &str,
        cache: &HashMap<String, DirCacheRow>,
        known_notes: &[NoteIdentity],
    ) -> AppResult<WorkspaceWalk> {
        let root = normalize_root(root)?;
        let mut walk = WorkspaceWalk::default();
        collect_notes(&root, &root, cache, known_notes, &mut walk, &self.walk_dirs)?;
        walk.notes.sort_by(|left, right| {
            right
                .modified_ms
                .cmp(&left.modified_ms)
                .then_with(|| left.relative_path.cmp(&right.relative_path))
        });
        Ok(walk)
    }

    pub fn read_note(&self, root: &str, relative_path: &str) -> AppResult<String> {
        let (_, path) = resolve_existing_note(root, relative_path)?;
        fs::read_to_string(&path).map_err(|error| AppError::io("Read note", &path, error))
    }

    pub fn write_note(&self, root: &str, relative_path: &str, content: &str) -> AppResult<()> {
        let (root_path, target) = match resolve_existing_note(root, relative_path) {
            Ok(result) => result,
            Err(error) if error.code == crate::domain::ErrorCode::NotFound => {
                resolve_new_note(root, relative_path)?
            }
            Err(error) => return Err(error),
        };
        create_parent_dirs(&root_path, &target)?;
        atomic_write(&target, content.as_bytes())
    }

    pub fn write_export_file(&self, path: &str, bytes: &[u8]) -> AppResult<()> {
        let path = validate_export_path(path)?;
        atomic_write(&path, bytes)
    }

    pub fn create_note(
        &self,
        root: &str,
        title: &str,
        extension: &str,
        folder: Option<&str>,
        tags: Option<&[String]>,
    ) -> AppResult<String> {
        let root = normalize_root(root)?;
        let extension = extension.trim_start_matches('.').to_ascii_lowercase();
        validate_note_extension(Path::new(&format!("note.{extension}")))?;
        let folder = validate_optional_directory(folder)?;
        let target_dir = folder
            .as_ref()
            .map(|path| root.join(path))
            .unwrap_or_else(|| root.clone());
        validate_nearest_existing_parent(&root, &target_dir.join(".memoir-parent-check"))?;
        fs::create_dir_all(&target_dir)
            .map_err(|error| AppError::io("Create note folder", &target_dir, error))?;
        let canonical_dir = target_dir
            .canonicalize()
            .map_err(|error| AppError::io("Resolve note folder", &target_dir, error))?;
        crate::domain::path::ensure_inside(&root, &canonical_dir)?;

        let slug = slugify(title);
        let tags = yaml_tags(tags);
        for index in 0..1000 {
            let file_name = if index == 0 {
                format!("{slug}.{extension}")
            } else {
                format!("{slug}-{index}.{extension}")
            };
            let path = canonical_dir.join(file_name);
            if !path.exists() {
                let heading = if title.trim().is_empty() {
                    "Untitled"
                } else {
                    title.trim()
                };
                let content = format!(
                    "---\ntitle: {}\ntags: {tags}\n---\n\n# {heading}\n",
                    yaml_quote(heading)
                );
                atomic_write(&path, content.as_bytes())?;
                return to_relative_path(&root, &path);
            }
        }
        Err(AppError::conflict("Unable to find a unique file name."))
    }

    /// Write an imported article as a new note: frontmatter header with the
    /// suggested title plus the converted markdown body. Duplicate names get
    /// the same `-1`/`-2` suffixes as `create_note`.
    pub fn import_note(
        &self,
        root: &str,
        title: &str,
        markdown: &str,
        folder: Option<&str>,
    ) -> AppResult<String> {
        let root = normalize_root(root)?;
        let folder = validate_optional_directory(folder)?;
        let target_dir = folder
            .as_ref()
            .map(|path| root.join(path))
            .unwrap_or_else(|| root.clone());
        validate_nearest_existing_parent(&root, &target_dir.join(".memoir-parent-check"))?;
        fs::create_dir_all(&target_dir)
            .map_err(|error| AppError::io("Create note folder", &target_dir, error))?;
        let canonical_dir = target_dir
            .canonicalize()
            .map_err(|error| AppError::io("Resolve note folder", &target_dir, error))?;
        crate::domain::path::ensure_inside(&root, &canonical_dir)?;

        let heading = if title.trim().is_empty() { "Untitled" } else { title.trim() };
        let content = format!(
            "---\ntitle: {}\ntags: []\n---\n\n{markdown}\n",
            yaml_quote(heading)
        );
        let slug = slugify(heading);
        for index in 0..1000 {
            let file_name = if index == 0 {
                format!("{slug}.md")
            } else {
                format!("{slug}-{index}.md")
            };
            let path = canonical_dir.join(file_name);
            if !path.exists() {
                atomic_write(&path, content.as_bytes())?;
                return to_relative_path(&root, &path);
            }
        }
        Err(AppError::conflict("Unable to find a unique file name."))
    }

    pub fn rename_note(
        &self,
        root: &str,
        old_relative_path: &str,
        new_relative_path: &str,
    ) -> AppResult<String> {
        let (root, old_path) = resolve_existing_note(root, old_relative_path)?;
        let relative = validate_relative_path(new_relative_path)?;
        validate_note_extension(&relative)?;
        let new_path = root.join(&relative);
        if new_path.exists() {
            return Err(AppError::conflict(
                "A note already exists at the target path.",
            ));
        }
        validate_nearest_existing_parent(&root, &new_path)?;
        create_parent_dirs(&root, &new_path)?;
        fs::rename(&old_path, &new_path)
            .map_err(|error| AppError::io("Rename note", &old_path, error))?;
        to_relative_path(&root, &new_path)
    }

    pub fn delete_note(&self, root: &str, relative_path: &str) -> AppResult<String> {
        let (root, note_path) = resolve_existing_note(root, relative_path)?;
        let original_path = to_relative_path(&root, &note_path)?;
        move_to_workspace_trash(&root, &note_path, "deleted-note.md", &original_path, false)
    }

    pub fn scan_attachments(&self, root: &str) -> AppResult<Vec<AttachmentFile>> {
        let root = normalize_root(root)?;
        let mut attachments = Vec::new();
        collect_attachment_tree(&root, &root.join(ATTACHMENTS_DIR), &mut attachments)?;
        attachments.sort_by(|left, right| {
            right
                .modified_ms
                .cmp(&left.modified_ms)
                .then_with(|| left.relative_path.cmp(&right.relative_path))
        });
        Ok(attachments)
    }

    pub fn save_attachment(
        &self,
        root: &str,
        bytes: &[u8],
        file_name: Option<&str>,
        mime_type: Option<&str>,
    ) -> AppResult<AttachmentFile> {
        write_attachment_bytes(root, bytes, file_name, mime_type)
    }

    pub fn import_attachment(&self, root: &str, source_path: &str) -> AppResult<AttachmentFile> {
        let source = PathBuf::from(source_path);
        let metadata = fs::metadata(&source)
            .map_err(|error| AppError::io("Inspect source attachment", &source, error))?;
        if !metadata.is_file() {
            return Err(AppError::not_found("Source file does not exist."));
        }
        let file_name = source.file_name().and_then(|value| value.to_str());
        let mut reader = fs::File::open(&source)
            .map_err(|error| AppError::io("Read source attachment", &source, error))?;
        let (extension, header) = crate::domain::attachment::validate_attachment_import(
            file_name,
            &metadata,
            &mut reader,
        )?;
        // Re-emit the sniffed header in front of the unread remainder so the
        // copy sees the complete byte stream.
        use std::io::Read as _;
        let stream = std::io::Cursor::new(header).chain(reader);
        write_attachment_from_reader(root, stream, file_name, &extension)
    }

    pub fn delete_attachment(&self, root: &str, relative_path: &str) -> AppResult<String> {
        let (root, attachment_path) = resolve_existing_attachment(root, relative_path)?;
        let original_path = to_relative_path(&root, &attachment_path)?;
        move_to_workspace_trash(&root, &attachment_path, "deleted-attachment", &original_path, true)
    }

    /// Lists everything currently sitting in the workspace trash.
    pub fn list_trash(&self, root: &str) -> AppResult<Vec<TrashEntry>> {
        let root = normalize_root(root)?;
        let trash = root.join(TRASH_DIR);
        if !trash.exists() {
            return Ok(Vec::new());
        }
        let mut manifest = read_trash_manifest(&root);
        sync_manifest_with_disk(&root, &mut manifest)?;
        let mut entries = manifest.entries;
        entries.sort_by(|left, right| {
            right
                .deleted_at_ms
                .cmp(&left.deleted_at_ms)
                .then_with(|| left.trash_name.cmp(&right.trash_name))
        });
        Ok(entries)
    }

    /// Moves one trashed file back to its original path. If the original
    /// location is occupied, the file is restored next to it with a `-restored`
    /// suffix (keeping uniqueness). Returns the final restored path.
    pub fn restore_trash_item(&self, root: &str, trash_name: &str) -> AppResult<String> {
        let root = normalize_root(root)?;
        let (relative_original, is_attachment, trash_path) = {
            let mut manifest = read_trash_manifest(&root);
            sync_manifest_with_disk(&root, &mut manifest)?;
            let entry = manifest
                .entries
                .iter()
                .find(|entry| entry.trash_name == trash_name)
                .cloned()
                .ok_or_else(|| AppError::not_found("Trash item not found."))?;
            (entry.original_path.clone(), entry.is_attachment, root.join(TRASH_DIR).join(&entry.trash_name))
        };
        if !trash_path.is_file() {
            return Err(AppError::not_found("Trash item file is missing."));
        }

        let original = validate_relative_path(&relative_original)?;
        if is_attachment {
            if let Err(error) =
                crate::domain::attachment::validate_attachment_extension(&original)
            {
                return Err(error);
            }
        } else if let Err(error) = validate_note_extension(&original) {
            return Err(error);
        }

        let mut target = root.join(&original);
        if target.exists() {
            target = unique_restored_path(&target);
        }
        let parent = target
            .parent()
            .ok_or_else(|| AppError::invalid_path("Restore target has no parent."))?;
        fs::create_dir_all(parent)
            .map_err(|error| AppError::io("Create restore directory", parent, error))?;
        let canonical = parent
            .canonicalize()
            .map_err(|error| AppError::io("Resolve restore directory", parent, error))?;
        crate::domain::path::ensure_inside(&root, &canonical)?;
        fs::rename(&trash_path, &target)
            .map_err(|error| AppError::io("Restore trash item", &trash_path, error))?;
        // The item physically moved; drop its manifest row.
        let mut manifest = read_trash_manifest(&root);
        manifest.remove_by_trash_name(trash_name);
        write_trash_manifest(&root, &manifest)?;
        Ok(to_relative_path(&root, &target)?)
    }

    /// Permanently deletes one trashed file.
    pub fn purge_trash_item(&self, root: &str, trash_name: &str) -> AppResult<()> {
        let root = normalize_root(root)?;
        let trash = root.join(TRASH_DIR);
        // trash_name comes from the frontend; never let it escape the trash dir.
        let name_path = validate_relative_path(trash_name)?;
        let target = trash.join(&name_path);
        let canonical = target
            .canonicalize()
            .map_err(|error| AppError::io("Resolve trash item", &target, error))?;
        let canonical_trash = trash
            .canonicalize()
            .map_err(|error| AppError::io("Resolve trash directory", &trash, error))?;
        crate::domain::path::ensure_inside(&canonical_trash, &canonical)?;
        if !canonical.is_file() {
            return Err(AppError::not_found("Trash item does not exist."));
        }
        fs::remove_file(&canonical)
            .map_err(|error| AppError::io("Purge trash item", &canonical, error))?;
        let mut manifest = read_trash_manifest(&root);
        manifest.remove_by_trash_name(&name_path.to_string_lossy());
        write_trash_manifest(&root, &manifest)?;
        Ok(())
    }

    /// Permanently deletes every trashed file.
    pub fn empty_trash(&self, root: &str) -> AppResult<()> {
        let root = normalize_root(root)?;
        let trash = root.join(TRASH_DIR);
        if !trash.exists() {
            return Ok(());
        }
        let metadata = fs::symlink_metadata(&trash)
            .map_err(|error| AppError::io("Inspect trash directory", &trash, error))?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err(AppError::invalid_path(
                "Trash directory is not a directory.",
            ));
        }
        let mut manifest = read_trash_manifest(&root);
        sync_manifest_with_disk(&root, &mut manifest)?;
        for entry in &manifest.entries {
            let path = trash.join(&entry.trash_name);
            if path.is_file() {
                fs::remove_file(&path)
                    .map_err(|error| AppError::io("Empty trash item", &path, error))?;
            }
        }
        write_trash_manifest(&root, &TrashManifest::default())?;
        Ok(())
    }

    pub fn scan_attachments_cached(
        &self,
        root: &str,
        cache: &HashMap<String, DirCacheRow>,
        known_paths: &[String],
    ) -> AppResult<AttachmentWalk> {
        let root = normalize_root(root)?;
        let attachments_dir = root.join(ATTACHMENTS_DIR);
        let mut walk = AttachmentWalk::default();
        if !attachments_dir.exists() {
            return Ok(walk);
        }
        let metadata = fs::symlink_metadata(&attachments_dir).map_err(|error| {
            AppError::io("Inspect attachments directory", &attachments_dir, error)
        })?;
        if metadata.file_type().is_symlink() {
            return Err(AppError::invalid_path(
                "Attachments directory cannot be a symbolic link.",
            ));
        }
        if !metadata.is_dir() {
            return Err(AppError::invalid_path(
                "Attachments path is not a directory.",
            ));
        }
        collect_attachments_cached(
            &root,
            &attachments_dir,
            cache,
            known_paths,
            &mut walk,
            &self.attachment_walk_dirs,
        )?;
        walk.files.sort_by(|left, right| {
            right
                .modified_ms
                .cmp(&left.modified_ms)
                .then_with(|| left.relative_path.cmp(&right.relative_path))
        });
        Ok(walk)
    }

    pub fn stat_sync_file(&self, root: &str, relative_path: &str) -> AppResult<FileIdentity> {
        let (root_path, path) = resolve_sync_path(root, relative_path, true)?;
        file_identity_from_path(&root_path, &path)
    }

    pub fn read_sync_file(&self, root: &str, relative_path: &str) -> AppResult<Vec<u8>> {
        let path = resolve_sync_path(root, relative_path, true)?.1;
        fs::read(&path).map_err(|error| AppError::io("Read sync file", &path, error))
    }

    pub fn hash_sync_file(&self, root: &str, relative_path: &str) -> AppResult<String> {
        let path = resolve_sync_path(root, relative_path, true)?.1;
        hash_file(&path)
    }

    pub fn write_sync_file(
        &self,
        root: &str,
        relative_path: &str,
        bytes: &[u8],
    ) -> AppResult<FileIdentity> {
        if is_attachment_relative(Path::new(relative_path)) || is_conflict_sidecar(relative_path) {
            let extension = Path::new(relative_path)
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or_default();
            if bytes.len() > max_attachment_bytes_for_extension(extension) {
                return Err(AppError::attachment_too_large());
            }
        }
        let (root_path, target) = match resolve_sync_path(root, relative_path, true) {
            Ok(resolved) => resolved,
            Err(error) if error.code == crate::domain::ErrorCode::NotFound => {
                resolve_sync_path(root, relative_path, false)?
            }
            Err(error) => return Err(error),
        };
        create_parent_dirs(&root_path, &target)?;
        atomic_write(&target, bytes)?;
        file_identity_from_path(&root_path, &target)
    }

    pub fn delete_sync_file(&self, root: &str, relative_path: &str) -> AppResult<String> {
        if is_note_relative(relative_path) {
            self.delete_note(root, relative_path)
        } else {
            self.delete_attachment(root, relative_path)
        }
    }
}

fn resolve_sync_path(
    root: &str,
    relative_path: &str,
    existing: bool,
) -> AppResult<(PathBuf, PathBuf)> {
    if !is_writable_sync_path(relative_path) {
        return Err(AppError::invalid_path(
            "Cloud sync only writes notes and image attachments.",
        ));
    }
    if is_note_relative(relative_path) {
        if existing {
            resolve_existing_note(root, relative_path)
        } else {
            resolve_new_note(root, relative_path)
        }
    } else if is_attachment_relative(Path::new(relative_path)) {
        if existing {
            resolve_existing_attachment(root, relative_path)
        } else {
            resolve_new_attachment(root, relative_path)
        }
    } else {
        Err(AppError::invalid_path(
            "Cloud sync only writes notes and image attachments.",
        ))
    }
}

fn file_identity_from_path(root: &Path, path: &Path) -> AppResult<FileIdentity> {
    let metadata =
        fs::metadata(path).map_err(|error| AppError::io("Inspect synced file", path, error))?;
    Ok(FileIdentity {
        relative_path: to_relative_path(root, path)?,
        size: metadata.len(),
        modified_ms: modified_ms(metadata.modified()),
        etag: None,
        hash: hash_file(path).ok(),
    })
}

fn hash_file(path: &Path) -> AppResult<String> {
    use sha2::{Digest, Sha256};
    let bytes = fs::read(path).map_err(|error| AppError::io("Hash synced file", path, error))?;
    Ok(format!("{:x}", Sha256::digest(&bytes)))
}

fn write_attachment_bytes(
    root: &str,
    bytes: &[u8],
    file_name: Option<&str>,
    mime_type: Option<&str>,
) -> AppResult<AttachmentFile> {
    let extension = resolve_attachment_extension(file_name, mime_type, bytes)?;
    write_attachment_named(root, bytes, file_name, &extension)
}

/// Shared destination logic for in-memory saves and streaming imports:
/// sanitizes the stem, resolves a unique month-directory path, then writes
/// via the caller-provided strategy (full-buffer or streaming copy).
fn write_attachment_named(
    root: &str,
    bytes: &[u8],
    file_name: Option<&str>,
    extension: &str,
) -> AppResult<AttachmentFile> {
    let stem = file_name
        .map(sanitize_attachment_file_name)
        .map(|name| {
            Path::new(&name)
                .file_stem()
                .and_then(|value| value.to_str())
                .unwrap_or("image")
                .to_string()
        })
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "image".into());
    let preferred = format!("{stem}.{extension}");
    let root_path = normalize_root(root)?;
    let month = attachment_month_dir();
    let attachments_dir = root_path.join(ATTACHMENTS_DIR);
    let month_dir = attachments_dir.join(&month);
    fs::create_dir_all(&month_dir)
        .map_err(|error| AppError::io("Create attachments directory", &month_dir, error))?;
    let canonical_dir = attachments_dir
        .canonicalize()
        .map_err(|error| AppError::io("Resolve attachments directory", &attachments_dir, error))?;
    crate::domain::path::ensure_inside(&root_path, &canonical_dir)?;
    let unique_name = unique_file_name(&preferred, |candidate| {
        canonical_dir.join(&month).join(candidate).exists()
    });
    let relative = format!("{ATTACHMENTS_DIR}/{month}/{unique_name}");
    let (_, target) = resolve_new_attachment(root, &relative)?;
    create_parent_dirs(&root_path, &target)?;
    atomic_write(&target, bytes)?;
    attachment_file_from_path(&root_path, &target)
}

/// Streaming import path: `reader` chains the sniffed header bytes in front
/// of the rest of the file, so the copy streams through in constant memory.
fn write_attachment_from_reader(
    root: &str,
    reader: impl io::Read,
    file_name: Option<&str>,
    extension: &str,
) -> AppResult<AttachmentFile> {
    let stem = file_name
        .map(sanitize_attachment_file_name)
        .map(|name| {
            Path::new(&name)
                .file_stem()
                .and_then(|value| value.to_str())
                .unwrap_or("image")
                .to_string()
        })
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "image".into());
    let preferred = format!("{stem}.{extension}");
    let root_path = normalize_root(root)?;
    let month = attachment_month_dir();
    let attachments_dir = root_path.join(ATTACHMENTS_DIR);
    let month_dir = attachments_dir.join(&month);
    fs::create_dir_all(&month_dir)
        .map_err(|error| AppError::io("Create attachments directory", &month_dir, error))?;
    let canonical_dir = attachments_dir
        .canonicalize()
        .map_err(|error| AppError::io("Resolve attachments directory", &attachments_dir, error))?;
    crate::domain::path::ensure_inside(&root_path, &canonical_dir)?;
    let unique_name = unique_file_name(&preferred, |candidate| {
        canonical_dir.join(&month).join(candidate).exists()
    });
    let relative = format!("{ATTACHMENTS_DIR}/{month}/{unique_name}");
    let (_, target) = resolve_new_attachment(root, &relative)?;
    create_parent_dirs(&root_path, &target)?;
    atomic_copy(&target, reader)?;
    attachment_file_from_path(&root_path, &target)
}

fn collect_attachments_cached(
    root: &Path,
    current: &Path,
    cache: &HashMap<String, DirCacheRow>,
    known_paths: &[String],
    walk: &mut AttachmentWalk,
    walk_dirs: &AtomicUsize,
) -> AppResult<()> {
    let dir_key = relative_dir(root, current);
    let dir_meta = match fs::symlink_metadata(current) {
        Ok(metadata) => metadata,
        Err(_) => return Ok(()),
    };
    if dir_meta.file_type().is_symlink() || !dir_meta.is_dir() {
        return Ok(());
    }
    let dir_mtime = dir_cache_mtime(&dir_meta);
    let dir_size = i64::try_from(dir_meta.len()).unwrap_or(i64::MAX);
    if let Some(cached) = cache.get(&dir_key) {
        if cached.modified_ms == dir_mtime && cached.size == dir_size {
            walk.reused_dirs.push(dir_key.clone());
            stat_known_attachments(root, &dir_key, known_paths, walk);
            visit_cached_attachment_children(root, &dir_key, cache, known_paths, walk, walk_dirs)?;
            return Ok(());
        }
    }

    walk_dirs.fetch_add(1, Ordering::Relaxed);
    let entries =
        fs::read_dir(current).map_err(|error| AppError::io("Read attachments", current, error))?;
    let mut entry_count = 0_i64;
    for entry in entries {
        let entry = entry.map_err(|error| {
            AppError::new(
                crate::domain::ErrorCode::Io,
                "Unable to read attachment entry.",
            )
            .with_details(error.to_string())
        })?;
        entry_count += 1;
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path)
            .map_err(|error| AppError::io("Inspect attachment entry", &path, error))?;
        if metadata.file_type().is_symlink() {
            continue;
        }
        if metadata.is_dir() {
            if !should_skip_dir(&path) {
                collect_attachments_cached(root, &path, cache, known_paths, walk, walk_dirs)?;
            }
            continue;
        }
        if let Some(identity) = syncable_attachment_identity(root, &path, &metadata) {
            walk.files.push(identity);
        }
    }
    walk.walked_dirs.push(DirCacheRow {
        relative_dir: dir_key,
        modified_ms: dir_mtime,
        size: dir_size,
        entry_count,
    });
    Ok(())
}

fn stat_known_attachments(
    root: &Path,
    dir_key: &str,
    known_paths: &[String],
    walk: &mut AttachmentWalk,
) {
    for relative_path in known_paths {
        if crate::domain::folder_of(relative_path) != dir_key {
            continue;
        }
        let path = root.join(relative_path);
        let Ok(metadata) = fs::symlink_metadata(&path) else {
            continue;
        };
        if let Some(identity) = syncable_attachment_identity(root, &path, &metadata) {
            walk.files.push(identity);
        }
    }
}

fn visit_cached_attachment_children(
    root: &Path,
    dir_key: &str,
    cache: &HashMap<String, DirCacheRow>,
    known_paths: &[String],
    walk: &mut AttachmentWalk,
    walk_dirs: &AtomicUsize,
) -> AppResult<()> {
    let children = cache
        .keys()
        .filter(|child| is_direct_child_dir(dir_key, child))
        .cloned()
        .collect::<Vec<_>>();
    for child in children {
        let path = root.join(&child);
        if should_skip_dir(&path) {
            continue;
        }
        collect_attachments_cached(root, &path, cache, known_paths, walk, walk_dirs)?;
    }
    Ok(())
}

fn syncable_attachment_identity(
    root: &Path,
    path: &Path,
    metadata: &fs::Metadata,
) -> Option<FileIdentity> {
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return None;
    }
    let file_name = path.file_name().and_then(|value| value.to_str())?;
    if file_name.starts_with('.') {
        return None;
    }
    let relative_path = to_relative_path(root, path).ok()?;
    if is_conflict_sidecar(&relative_path) {
        return None;
    }
    if crate::domain::attachment::validate_attachment_extension(path).is_err() {
        return None;
    }
    Some(FileIdentity {
        relative_path,
        size: metadata.len(),
        modified_ms: modified_ms(metadata.modified()),
        etag: None,
        hash: None,
    })
}

fn collect_attachment_tree(
    root: &Path,
    attachments_dir: &Path,
    attachments: &mut Vec<AttachmentFile>,
) -> AppResult<()> {
    if !attachments_dir.exists() {
        return Ok(());
    }
    let metadata = fs::symlink_metadata(attachments_dir)
        .map_err(|error| AppError::io("Inspect attachments directory", attachments_dir, error))?;
    if metadata.file_type().is_symlink() {
        return Err(AppError::invalid_path(
            "Attachments directory cannot be a symbolic link.",
        ));
    }
    if !metadata.is_dir() {
        return Err(AppError::invalid_path(
            "Attachments path is not a directory.",
        ));
    }
    collect_attachments(root, attachments_dir, attachments)
}

fn collect_attachments(
    root: &Path,
    current: &Path,
    attachments: &mut Vec<AttachmentFile>,
) -> AppResult<()> {
    let entries =
        fs::read_dir(current).map_err(|error| AppError::io("Read attachments", current, error))?;
    for entry in entries {
        let entry = entry.map_err(|error| {
            AppError::new(
                crate::domain::ErrorCode::Io,
                "Unable to read attachment entry.",
            )
            .with_details(error.to_string())
        })?;
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path)
            .map_err(|error| AppError::io("Inspect attachment entry", &path, error))?;
        if metadata.file_type().is_symlink() {
            continue;
        }
        if metadata.is_dir() {
            if !should_skip_dir(&path) {
                collect_attachments(root, &path, attachments)?;
            }
            continue;
        }
        if !metadata.is_file() {
            continue;
        }
        let file_name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default();
        if file_name.starts_with('.') {
            continue;
        }
        if crate::domain::attachment::validate_attachment_extension(&path).is_err() {
            continue;
        }
        attachments.push(attachment_file_from_metadata(root, &path, &metadata)?);
    }
    Ok(())
}

fn attachment_file_from_path(root: &Path, path: &Path) -> AppResult<AttachmentFile> {
    let metadata = fs::metadata(path)
        .map_err(|error| AppError::io("Inspect saved attachment", path, error))?;
    attachment_file_from_metadata(root, path, &metadata)
}

fn attachment_file_from_metadata(
    root: &Path,
    path: &Path,
    metadata: &fs::Metadata,
) -> AppResult<AttachmentFile> {
    let relative_path = to_relative_path(root, path)?;
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_string();
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    Ok(AttachmentFile {
        relative_path,
        file_name,
        extension: extension.clone(),
        mime_type: mime_from_extension(&extension).to_string(),
        modified_ms: modified_ms(metadata.modified()),
        size: metadata.len(),
    })
}

const TRASH_DIR: &str = ".memoir-trash";
const TRASH_MANIFEST: &str = "manifest.json";

fn move_to_workspace_trash(
    root: &Path,
    file_path: &Path,
    fallback_name: &str,
    original_path: &str,
    is_attachment: bool,
) -> AppResult<String> {
    let trash = root.join(TRASH_DIR);
    if trash.exists() {
        let metadata = fs::symlink_metadata(&trash)
            .map_err(|error| AppError::io("Inspect trash directory", &trash, error))?;
        if metadata.file_type().is_symlink() {
            return Err(AppError::invalid_path(
                "Trash directory cannot be a symbolic link.",
            ));
        }
    }
    fs::create_dir_all(&trash)
        .map_err(|error| AppError::io("Create trash directory", &trash, error))?;
    let canonical_trash = trash
        .canonicalize()
        .map_err(|error| AppError::io("Resolve trash directory", &trash, error))?;
    crate::domain::path::ensure_inside(root, &canonical_trash)?;
    let file_name = file_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(fallback_name);
    let timestamp = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default();
    let target = unique_trash_path(&canonical_trash, timestamp, file_name);
    let size = fs::metadata(file_path).map(|metadata| metadata.len()).unwrap_or(0);
    fs::rename(file_path, &target)
        .map_err(|error| AppError::io("Move file to trash", file_path, error))?;
    let trash_name = target
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(fallback_name)
        .to_string();
    // Record the original path so the trash panel can restore it later.
    let mut manifest = read_trash_manifest(root);
    manifest.entries.push(TrashEntry {
        trash_name: trash_name.clone(),
        original_path: original_path.replace('\\', "/"),
        trash_path: format!("{TRASH_DIR}/{trash_name}"),
        deleted_at_ms: TrashManifest::now_ms(),
        size,
        is_attachment,
    });
    write_trash_manifest(root, &manifest)?;
    to_relative_path(root, &target)
}

fn trash_manifest_path(root: &Path) -> PathBuf {
    root.join(TRASH_DIR).join(TRASH_MANIFEST)
}

fn read_trash_manifest(root: &Path) -> TrashManifest {
    fs::read_to_string(trash_manifest_path(root))
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn write_trash_manifest(root: &Path, manifest: &TrashManifest) -> AppResult<()> {
    let path = trash_manifest_path(root);
    let parent = path
        .parent()
        .ok_or_else(|| AppError::invalid_path("Trash manifest has no parent."))?;
    if !parent.exists() {
        // Nothing was ever trashed; nothing to persist.
        if manifest.entries.is_empty() {
            return Ok(());
        }
        fs::create_dir_all(parent)
            .map_err(|error| AppError::io("Create trash directory", parent, error))?;
    }
    if manifest.entries.is_empty() {
        // Keep the manifest file only when it already exists; remove stale rows.
        if path.exists() {
            atomic_write(&path, b"{\"entries\":[]}")?;
        }
        return Ok(());
    }
    let json = serde_json::to_string_pretty(manifest)
        .map_err(|error| AppError::io("Serialize trash manifest", &path, error.into()))?;
    atomic_write(&path, json.as_bytes())
}

/// Reconciles manifest rows with what is actually on disk: adopts legacy
/// `{timestamp}-{file}` files that predate the manifest (inferring a root
/// original path) and drops rows whose file vanished.
fn sync_manifest_with_disk(root: &Path, manifest: &mut TrashManifest) -> AppResult<()> {
    let trash = root.join(TRASH_DIR);
    let on_disk: std::collections::HashSet<String> = fs::read_dir(&trash)
        .map(|entries| {
            entries
                .filter_map(|entry| {
                    let entry = entry.ok()?;
                    let name = entry.file_name().to_string_lossy().to_string();
                    let is_file = entry.file_type().ok().is_some_and(|kind| kind.is_file());
                    if is_file && name != TRASH_MANIFEST {
                        Some(name)
                    } else {
                        None
                    }
                })
                .collect()
        })
        .unwrap_or_default();

    // Drop manifest rows whose file is gone.
    manifest.entries.retain(|entry| on_disk.contains(&entry.trash_name));

    // Adopt legacy files that predate the manifest.
    let known: std::collections::HashSet<String> = manifest
        .entries
        .iter()
        .map(|entry| entry.trash_name.clone())
        .collect();
    let mut added = false;
    for name in &on_disk {
        if known.contains(name) {
            continue;
        }
        let path = trash.join(name);
        let size = fs::metadata(&path).map(|metadata| metadata.len()).unwrap_or(0);
        let deleted_at_ms = path
            .metadata()
            .and_then(|metadata| metadata.modified())
            .ok()
            .and_then(|modified| {
                modified
                    .duration_since(SystemTime::UNIX_EPOCH)
                    .ok()
                    .map(|duration| duration.as_millis())
            })
            .unwrap_or_else(TrashManifest::now_ms);
        manifest.entries.push(TrashEntry {
            trash_name: name.clone(),
            original_path: infer_legacy_original_path(name),
            trash_path: format!("{TRASH_DIR}/{name}"),
            deleted_at_ms,
            size,
            is_attachment: false,
        });
        added = true;
    }
    if added || manifest.entries.len() != on_disk.len() {
        write_trash_manifest(root, manifest)?;
    }
    Ok(())
}

/// `{timestamp}-{name}` legacy trash files restore to the workspace root as
/// `{name}` (the original directory information was not recorded).
fn infer_legacy_original_path(trash_name: &str) -> String {
    match trash_name.find('-') {
        Some(at) if trash_name[..at].chars().all(|ch| ch.is_ascii_digit()) => {
            trash_name[at + 1..].to_string()
        }
        _ => trash_name.to_string(),
    }
}

fn unique_restored_path(target: &Path) -> PathBuf {
    let stem = target
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("restored");
    let extension = target
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    let parent = target.parent().unwrap_or_else(|| Path::new("."));
    for index in 0..1000 {
        let name = if extension.is_empty() {
            format!("{stem}-restored-{index}")
        } else {
            format!("{stem}-restored-{index}.{extension}")
        };
        let candidate = parent.join(name);
        if !candidate.exists() {
            return candidate;
        }
    }
    parent.join(format!("{stem}-restored-overflow"))
}

#[derive(Debug, Default, Clone)]
pub struct WorkspaceWalk {
    pub notes: Vec<NoteIdentity>,
    pub walked_dirs: Vec<DirCacheRow>,
    pub reused_dirs: Vec<String>,
}

#[derive(Debug, Default, Clone)]
pub struct AttachmentWalk {
    pub files: Vec<FileIdentity>,
    pub walked_dirs: Vec<DirCacheRow>,
    pub reused_dirs: Vec<String>,
}

fn relative_dir(root: &Path, current: &Path) -> String {
    if current == root {
        return String::new();
    }
    to_relative_path(root, current).unwrap_or_default()
}

fn is_direct_child_dir(parent: &str, child: &str) -> bool {
    if parent == child || child.is_empty() {
        return false;
    }
    if parent.is_empty() {
        return !child.contains('/');
    }
    child
        .strip_prefix(parent)
        .and_then(|rest| rest.strip_prefix('/'))
        .is_some_and(|rest| !rest.is_empty() && !rest.contains('/'))
}

fn collect_notes(
    root: &Path,
    current: &Path,
    cache: &HashMap<String, DirCacheRow>,
    known_notes: &[NoteIdentity],
    walk: &mut WorkspaceWalk,
    walk_dirs: &AtomicUsize,
) -> AppResult<()> {
    let dir_key = relative_dir(root, current);
    let dir_meta = match fs::symlink_metadata(current) {
        Ok(metadata) => metadata,
        Err(_) => return Ok(()),
    };
    if dir_meta.file_type().is_symlink() || !dir_meta.is_dir() {
        return Ok(());
    }
    let dir_mtime = dir_cache_mtime(&dir_meta);
    let dir_size = i64::try_from(dir_meta.len()).unwrap_or(i64::MAX);
    if let Some(cached) = cache.get(&dir_key) {
        if cached.modified_ms == dir_mtime && cached.size == dir_size {
            // Skip read_dir of this directory only. Still stat known files and
            // visit each cached child dir — ancestor mtime is not proof a child is unchanged.
            walk.reused_dirs.push(dir_key.clone());
            stat_known_notes(root, &dir_key, known_notes, walk);
            visit_cached_children(root, &dir_key, cache, known_notes, walk, walk_dirs)?;
            return Ok(());
        }
    }

    walk_dirs.fetch_add(1, Ordering::Relaxed);
    let entries =
        fs::read_dir(current).map_err(|error| AppError::io("Read directory", current, error))?;
    let mut entry_count = 0_i64;
    for entry in entries {
        let entry = entry.map_err(|error| {
            AppError::new(
                crate::domain::ErrorCode::Io,
                "Unable to read directory entry.",
            )
            .with_details(error.to_string())
        })?;
        entry_count += 1;
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path)
            .map_err(|error| AppError::io("Inspect workspace entry", &path, error))?;
        if metadata.file_type().is_symlink() {
            continue;
        }
        if metadata.is_dir() {
            if !should_skip_dir(&path) {
                collect_notes(root, &path, cache, known_notes, walk, walk_dirs)?;
            }
            continue;
        }
        if metadata.is_file() && is_supported_note(&path) {
            if let Some(identity) = note_identity_from_metadata(root, &path, &metadata) {
                walk.notes.push(identity);
            }
        }
    }
    walk.walked_dirs.push(DirCacheRow {
        relative_dir: dir_key,
        modified_ms: dir_mtime,
        size: dir_size,
        entry_count,
    });
    Ok(())
}

fn stat_known_notes(
    root: &Path,
    dir_key: &str,
    known_notes: &[NoteIdentity],
    walk: &mut WorkspaceWalk,
) {
    for note in known_notes {
        if folder_of(&note.relative_path) != dir_key {
            continue;
        }
        let path = root.join(&note.relative_path);
        let Ok(metadata) = fs::symlink_metadata(&path) else {
            continue;
        };
        if metadata.file_type().is_symlink() || !metadata.is_file() || !is_supported_note(&path) {
            continue;
        }
        if let Some(identity) = note_identity_from_metadata(root, &path, &metadata) {
            walk.notes.push(identity);
        }
    }
}

fn visit_cached_children(
    root: &Path,
    dir_key: &str,
    cache: &HashMap<String, DirCacheRow>,
    known_notes: &[NoteIdentity],
    walk: &mut WorkspaceWalk,
    walk_dirs: &AtomicUsize,
) -> AppResult<()> {
    let children = cache
        .keys()
        .filter(|child| is_direct_child_dir(dir_key, child))
        .cloned()
        .collect::<Vec<_>>();
    for child in children {
        let path = root.join(&child);
        if should_skip_dir(&path) {
            continue;
        }
        collect_notes(root, &path, cache, known_notes, walk, walk_dirs)?;
    }
    Ok(())
}

fn note_identity_from_metadata(
    root: &Path,
    path: &Path,
    metadata: &fs::Metadata,
) -> Option<NoteIdentity> {
    let relative_path = to_relative_path(root, path).ok()?;
    let file_name = path.file_name()?.to_str()?.to_string();
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    Some(NoteIdentity {
        relative_path,
        file_name,
        extension,
        modified_ms: modified_ms(metadata.modified()),
        size: metadata.len(),
    })
}

pub(crate) fn modified_ms(modified: io::Result<SystemTime>) -> u128 {
    modified
        .ok()
        .and_then(|value| value.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}

/// Directory mtime fingerprint stored on `DirCacheRow.modified_ms`.
///
/// Uses nanoseconds so two creates in the same millisecond still invalidate the
/// skip-`read_dir` cache. Older rows stored milliseconds and simply miss once.
fn dir_cache_mtime(metadata: &fs::Metadata) -> i64 {
    metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(SystemTime::UNIX_EPOCH).ok())
        .and_then(|duration| i64::try_from(duration.as_nanos()).ok())
        .unwrap_or(i64::MAX)
}

fn validate_optional_directory(folder: Option<&str>) -> AppResult<Option<PathBuf>> {
    let Some(folder) = folder else {
        return Ok(None);
    };
    let normalized = folder.trim().trim_matches('/').trim_matches('\\');
    if normalized.is_empty() {
        return Ok(None);
    }
    validate_relative_path(normalized).map(Some)
}

pub fn slugify(title: &str) -> String {
    let mut slug = String::new();
    let mut last_dash = false;
    for character in title.trim().chars() {
        if character.is_alphanumeric() {
            slug.extend(character.to_lowercase());
            last_dash = false;
        } else if (character.is_whitespace() || "-_.".contains(character))
            && !last_dash
            && !slug.is_empty()
        {
            slug.push('-');
            last_dash = true;
        }
    }
    let slug = slug.trim_matches('-');
    if slug.is_empty() {
        "untitled".into()
    } else {
        slug.into()
    }
}

fn yaml_quote(value: &str) -> String {
    format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
}

fn yaml_tags(tags: Option<&[String]>) -> String {
    let tags = tags
        .unwrap_or_default()
        .iter()
        .map(|tag| tag.trim())
        .filter(|tag| !tag.is_empty())
        .map(yaml_quote)
        .collect::<Vec<_>>();
    if tags.is_empty() {
        "[]".into()
    } else {
        format!("[{}]", tags.join(", "))
    }
}

fn validate_export_path(path: &str) -> AppResult<PathBuf> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(AppError::invalid_path("Export path is empty."));
    }
    let path = PathBuf::from(trimmed);
    if !path.is_absolute() {
        return Err(AppError::invalid_path("Export path must be absolute."));
    }
    if path
        .components()
        .any(|component| matches!(component, Component::ParentDir))
    {
        return Err(AppError::invalid_path("Export path is invalid."));
    }
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !matches!(extension.as_str(), "pdf" | "html" | "md" | "doc" | "docx" | "png" | "svg") {
        return Err(AppError::new(
            crate::domain::ErrorCode::UnsupportedExtension,
            "Only PDF, HTML, Markdown, Word, PNG and SVG export is supported.",
        ));
    }
    Ok(path)
}

fn unique_trash_path(trash: &Path, timestamp: u64, file_name: &str) -> PathBuf {
    for index in 0..1000 {
        let suffix = if index == 0 {
            String::new()
        } else {
            format!("-{index}")
        };
        let target = trash.join(format!("{timestamp}{suffix}-{file_name}"));
        if !target.exists() {
            return target;
        }
    }
    trash.join(format!("{timestamp}-overflow-{file_name}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::Ordering;
    use tempfile::tempdir;

    #[test]
    fn attachment_dir_cache_skips_read_dir_until_the_folder_changes() {
        let dir = tempdir().unwrap();
        let root = dir.path();
        let month = root.join("attachments/2026-08");
        fs::create_dir_all(&month).unwrap();
        fs::write(month.join("photo.png"), [1, 2, 3, 4]).unwrap();

        let filesystem = LocalFileSystem::new();
        let first = filesystem
            .scan_attachments_cached(root.to_str().unwrap(), &HashMap::new(), &[])
            .unwrap();
        assert_eq!(first.files.len(), 1);
        assert!(filesystem.attachment_walk_dirs.load(Ordering::Relaxed) >= 2);

        let cache: HashMap<_, _> = first
            .walked_dirs
            .iter()
            .cloned()
            .map(|row| (row.relative_dir.clone(), row))
            .collect();
        let known = first
            .files
            .iter()
            .map(|file| file.relative_path.clone())
            .collect::<Vec<_>>();
        filesystem.attachment_walk_dirs.store(0, Ordering::Relaxed);
        let reused = filesystem
            .scan_attachments_cached(root.to_str().unwrap(), &cache, &known)
            .unwrap();
        assert_eq!(reused.files.len(), 1);
        assert_eq!(filesystem.attachment_walk_dirs.load(Ordering::Relaxed), 0);
        assert!(reused.reused_dirs.contains(&"attachments".to_string()));

        let other = month.join("other.png");
        let before_stamp = dir_cache_mtime(&fs::symlink_metadata(&month).unwrap());
        fs::write(&other, [5, 6, 7, 8]).unwrap();
        let started = std::time::Instant::now();
        while dir_cache_mtime(&fs::symlink_metadata(&month).unwrap()) == before_stamp {
            assert!(
                started.elapsed() < std::time::Duration::from_secs(2),
                "directory mtime did not change after adding a file"
            );
            std::thread::sleep(std::time::Duration::from_millis(10));
            let _ = fs::remove_file(&other);
            fs::write(&other, [5, 6, 7, 8]).unwrap();
        }
        filesystem.attachment_walk_dirs.store(0, Ordering::Relaxed);
        let changed = filesystem
            .scan_attachments_cached(root.to_str().unwrap(), &cache, &known)
            .unwrap();
        assert_eq!(changed.files.len(), 2);
        assert!(filesystem.attachment_walk_dirs.load(Ordering::Relaxed) > 0);
    }
}
