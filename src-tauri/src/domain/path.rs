use crate::domain::{AppError, AppResult};
use std::{
    fs,
    path::{Component, Path, PathBuf},
};

pub const NOTE_EXTENSIONS: [&str; 2] = ["md", "mdx"];
pub const IGNORED_DIRS: [&str; 14] = [
    ".git",
    ".memoir",
    ".memoir-trash",
    "attachments",
    "node_modules",
    "dist",
    "build",
    "target",
    ".next",
    ".turbo",
    "out",
    "coverage",
    "__pycache__",
    "venv",
];

pub fn normalize_root(root: &str) -> AppResult<PathBuf> {
    let path = PathBuf::from(root);
    if !path.exists() {
        return Err(AppError::not_found("Workspace does not exist."));
    }
    if !path.is_dir() {
        return Err(AppError::invalid_path("Workspace path is not a directory."));
    }
    // Windows canonicalize() returns verbatim paths (\\?\C:\...). Strip that
    // prefix so paths returned to the frontend stay human-readable and the
    // asset protocol can resolve workspace media correctly.
    Ok(dunce::simplified(
        &path
            .canonicalize()
            .map_err(|error| AppError::io("Open workspace", &path, error))?,
    )
    .to_path_buf())
}

pub fn normalize_workspace_key(root: &str) -> AppResult<String> {
    normalize_root(root).map(|path| path.to_string_lossy().to_string())
}

pub fn validate_relative_path(relative_path: &str) -> AppResult<PathBuf> {
    if relative_path.trim().is_empty() {
        return Err(AppError::invalid_path("Path cannot be empty."));
    }
    let path = Path::new(relative_path);
    if path.is_absolute() {
        return Err(AppError::invalid_path("Absolute paths are not allowed."));
    }
    if path
        .components()
        .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(AppError::invalid_path(
            "Path must stay inside the workspace.",
        ));
    }
    Ok(path.to_path_buf())
}

pub fn validate_note_extension(path: &Path) -> AppResult<()> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if NOTE_EXTENSIONS.contains(&extension.as_str()) {
        Ok(())
    } else {
        Err(AppError::unsupported_extension())
    }
}

pub fn resolve_existing_note(root: &str, relative_path: &str) -> AppResult<(PathBuf, PathBuf)> {
    let root = normalize_root(root)?;
    let relative = validate_relative_path(relative_path)?;
    validate_note_extension(&relative)?;
    let joined = root.join(relative);
    let canonical = joined
        .canonicalize()
        .map_err(|error| AppError::io("Resolve note", &joined, error))?;
    ensure_inside(&root, &canonical)?;
    if !canonical.is_file() {
        return Err(AppError::not_found("Note does not exist."));
    }
    Ok((root, canonical))
}

pub fn resolve_new_note(root: &str, relative_path: &str) -> AppResult<(PathBuf, PathBuf)> {
    let root = normalize_root(root)?;
    let relative = validate_relative_path(relative_path)?;
    validate_note_extension(&relative)?;
    let target = root.join(&relative);
    validate_nearest_existing_parent(&root, &target)?;
    Ok((root, target))
}

pub fn is_attachment_relative(relative: &Path) -> bool {
    crate::domain::attachment::is_attachment_relative(relative)
}

pub fn resolve_existing_attachment(
    root: &str,
    relative_path: &str,
) -> AppResult<(PathBuf, PathBuf)> {
    let root = normalize_root(root)?;
    let relative = validate_relative_path(relative_path)?;
    crate::domain::attachment::validate_attachment_extension(&relative)?;
    if !is_attachment_relative(&relative) {
        return Err(AppError::invalid_path(
            "Attachments must stay in the attachments folder.",
        ));
    }
    let joined = root.join(relative);
    let canonical = joined
        .canonicalize()
        .map_err(|error| AppError::io("Resolve attachment", &joined, error))?;
    ensure_inside(&root, &canonical)?;
    if !canonical.is_file() {
        return Err(AppError::not_found("Attachment does not exist."));
    }
    Ok((root, canonical))
}

pub fn resolve_new_attachment(root: &str, relative_path: &str) -> AppResult<(PathBuf, PathBuf)> {
    let root = normalize_root(root)?;
    let relative = validate_relative_path(relative_path)?;
    crate::domain::attachment::validate_attachment_extension(&relative)?;
    if !is_attachment_relative(&relative) {
        return Err(AppError::invalid_path(
            "Attachments must stay in the attachments folder.",
        ));
    }
    let target = root.join(&relative);
    validate_nearest_existing_parent(&root, &target)?;
    Ok((root, target))
}

pub fn validate_nearest_existing_parent(root: &Path, target: &Path) -> AppResult<()> {
    let mut current = target.parent().unwrap_or(root);
    while !current.exists() {
        current = current
            .parent()
            .ok_or_else(|| AppError::invalid_path("Path has no valid workspace parent."))?;
    }
    let canonical = current
        .canonicalize()
        .map_err(|error| AppError::io("Resolve parent", current, error))?;
    ensure_inside(root, &canonical)
}

pub fn ensure_inside(root: &Path, path: &Path) -> AppResult<()> {
    if paths_equivalent(root, path) {
        Ok(())
    } else {
        Err(AppError::invalid_path(
            "Resolved path escapes the workspace.",
        ))
    }
}

/// Compare paths tolerantly: case-insensitive on Windows (drive letters and
/// user input differ in case) and ignoring the Windows verbatim prefix so
/// legacy `\\?\C:\...` keys still resolve to the same workspace.
fn paths_equivalent(root: &Path, path: &Path) -> bool {
    let root = strip_verbatim_prefix(root);
    let path = strip_verbatim_prefix(path);
    #[cfg(windows)]
    {
        path.starts_with(&root)
            || path
                .to_string_lossy()
                .to_lowercase()
                .starts_with(&root.to_string_lossy().to_lowercase())
    }
    #[cfg(not(windows))]
    {
        path.starts_with(&root)
    }
}

pub fn to_relative_path(root: &Path, path: &Path) -> AppResult<String> {
    let root = strip_verbatim_prefix(root);
    let path = strip_verbatim_prefix(path);
    let relative = path
        .strip_prefix(&root)
        .ok()
        .map(|value| value.to_string_lossy().to_string())
        .or_else(|| {
            // Windows is case-insensitive; fall back to a lowercase comparison.
            let path_text = path.to_string_lossy().to_lowercase();
            let root_text = root.to_string_lossy().to_lowercase();
            path_text
                .strip_prefix(&root_text)
                .map(|tail| tail.trim_start_matches(['\\', '/']).to_string())
        })
        .ok_or_else(|| AppError::invalid_path("File is outside the workspace."))?;
    Ok(relative.replace('\\', "/"))
}

fn strip_verbatim_prefix(path: &Path) -> PathBuf {
    let text = path.as_os_str().to_string_lossy().to_string();
    match text.strip_prefix(r"\\?\") {
        Some(rest) => PathBuf::from(rest),
        None => path.to_path_buf(),
    }
}

pub fn should_skip_dir(path: &Path) -> bool {
    path.file_name()
        .and_then(|value| value.to_str())
        .map(|name| name.starts_with('.') || IGNORED_DIRS.contains(&name))
        .unwrap_or(false)
}

pub fn is_supported_note(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|extension| NOTE_EXTENSIONS.contains(&extension.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

pub fn create_parent_dirs(root: &Path, target: &Path) -> AppResult<()> {
    let parent = target
        .parent()
        .ok_or_else(|| AppError::invalid_path("Target has no parent directory."))?;
    fs::create_dir_all(parent)
        .map_err(|error| AppError::io("Create note directory", parent, error))?;
    let canonical = parent
        .canonicalize()
        .map_err(|error| AppError::io("Resolve note directory", parent, error))?;
    ensure_inside(root, &canonical)
}
