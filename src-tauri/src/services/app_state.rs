use crate::{
    domain::{
        app_update::{format_version, parse_version},
        cloud_sync::{sanitize_profile, CloudSyncProfile},
        note_parse::parse_note,
        path::{normalize_workspace_key, validate_relative_path},
        AiSessionRecord, AppError, AppResult, AppSettings, AppState, ErrorCode, FolderAppearance,
        LegacyStatePayload, MigrationResult, NoteVersion, NoteVersionMeta, WorkspaceLayout,
    },
    infrastructure::app_data::{stable_hash, AppDataRepository},
};
use std::{
    collections::BTreeSet,
    sync::{Arc, Mutex},
};

#[derive(Debug, Clone)]
pub struct AppStateService {
    repository: AppDataRepository,
    state_lock: Arc<Mutex<()>>,
}

impl AppStateService {
    pub fn new(repository: AppDataRepository) -> Self {
        Self {
            repository,
            state_lock: Arc::new(Mutex::new(())),
        }
    }

    pub fn load(&self) -> AppResult<AppState> {
        let mut state = self.repository.load_state()?;
        if self.migrate_legacy_workspace_keys(&mut state)? {
            self.repository.save_state(&state)?;
        }
        Ok(state)
    }

    /// Older releases persisted workspace keys as Windows verbatim paths
    /// (`\\?\C:\...`), which break frontend path joining and asset URLs.
    /// Rewrite those keys (and the derived draft/snapshot directories) to
    /// the plain form once on load.
    fn migrate_legacy_workspace_keys(&self, state: &mut AppState) -> AppResult<bool> {
        let mut renamed: Vec<(String, String)> = Vec::new();
        let mut rewrite = |key: &str, renamed: &mut Vec<(String, String)>| -> String {
            match key.strip_prefix(r"\\?\") {
                Some(rest) => {
                    renamed.push((key.to_string(), rest.to_string()));
                    rest.to_string()
                }
                None => key.to_string(),
            }
        };

        if let Some(workspace) = state.last_workspace.as_mut() {
            *workspace = rewrite(workspace, &mut renamed);
        }
        for workspace in state.recent_workspaces.iter_mut() {
            *workspace = rewrite(workspace, &mut renamed);
        }
        let favorite_keys: Vec<String> = state.favorites.keys().cloned().collect();
        for key in &favorite_keys {
            let new_key = rewrite(key, &mut renamed);
            if &new_key != key {
                let entries = state.favorites.remove(key).unwrap_or_default();
                state.favorites.insert(new_key, entries);
            }
        }
        let appearance_keys: Vec<String> = state.folder_appearances.keys().cloned().collect();
        for key in &appearance_keys {
            let new_key = rewrite(key, &mut renamed);
            if &new_key != key {
                let entries = state.folder_appearances.remove(key).unwrap_or_default();
                state.folder_appearances.insert(new_key, entries);
            }
        }
        let cloud_keys: Vec<String> = state.cloud_sync.keys().cloned().collect();
        for key in &cloud_keys {
            let new_key = rewrite(key, &mut renamed);
            if &new_key != key {
                let profile = state.cloud_sync.remove(key).unwrap_or_default();
                state.cloud_sync.insert(new_key, profile);
            }
        }

        let changed = !renamed.is_empty();
        for (old_key, new_key) in renamed {
            self.repository.migrate_workspace_key_hashes(&old_key, &new_key);
        }
        Ok(changed)
    }

    pub fn save_preferences(
        &self,
        preferences: AppSettings,
        last_workspace: Option<String>,
        sidebar_collapsed: bool,
        layout: Option<WorkspaceLayout>,
    ) -> AppResult<AppState> {
        let _guard = self
            .state_lock
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let mut state = self.repository.load_state()?;
        state.preferences = preferences;
        state.sidebar_collapsed = sidebar_collapsed;
        if let Some(layout) = layout {
            state.layout = layout.sanitized();
        }
        let last_workspace = last_workspace
            .map(|workspace| normalize_workspace_key(&workspace).unwrap_or(workspace));
        state.last_workspace = last_workspace.clone();
        if let Some(workspace) = last_workspace {
            state.recent_workspaces.retain(|item| item != &workspace);
            state.recent_workspaces.insert(0, workspace);
            state.recent_workspaces.truncate(10);
        }
        self.repository.save_state(&state)?;
        Ok(state)
    }

    pub fn save_window_frame(
        &self,
        width: f64,
        height: f64,
        maximized: bool,
    ) -> AppResult<AppState> {
        let _guard = self
            .state_lock
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let mut state = self.repository.load_state()?;
        let next = state
            .window
            .clone()
            .with_live_size(width, height, maximized);
        if next == state.window {
            return Ok(state);
        }
        state.window = next;
        self.repository.save_state(&state)?;
        Ok(state)
    }

    pub fn set_favorite(
        &self,
        workspace_root: String,
        relative_path: String,
        favorite: bool,
    ) -> AppResult<AppState> {
        let _guard = self
            .state_lock
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let workspace_root = normalize_workspace_key(&workspace_root)?;
        let mut state = self.repository.load_state()?;
        let mut favorites = state
            .favorites
            .remove(&workspace_root)
            .unwrap_or_default()
            .into_iter()
            .collect::<BTreeSet<_>>();
        if favorite {
            favorites.insert(relative_path);
        } else {
            favorites.remove(&relative_path);
        }
        state
            .favorites
            .insert(workspace_root, favorites.into_iter().collect());
        self.repository.save_state(&state)?;
        Ok(state)
    }

    pub fn set_folder_appearance(
        &self,
        workspace_root: String,
        folder: String,
        appearance: Option<FolderAppearance>,
    ) -> AppResult<AppState> {
        let _guard = self
            .state_lock
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let workspace_root = normalize_workspace_key(&workspace_root)?;
        let folder = validate_folder_key(&folder)?;
        let appearance = sanitize_folder_appearance(appearance);
        let mut state = self.repository.load_state()?;
        let mut workspace_map = state
            .folder_appearances
            .remove(&workspace_root)
            .unwrap_or_default();
        if let Some(appearance) = appearance {
            workspace_map.insert(folder, appearance);
        } else {
            workspace_map.remove(&folder);
        }
        if !workspace_map.is_empty() {
            state
                .folder_appearances
                .insert(workspace_root, workspace_map);
        }
        self.repository.save_state(&state)?;
        Ok(state)
    }

    /// Replaces the persisted AI chat sessions wholesale (the frontend owns
    /// the session list; this only stores what it sends).
    pub fn save_ai_sessions(
        &self,
        sessions: Vec<AiSessionRecord>,
        active_ai_session_id: Option<String>,
    ) -> AppResult<AppState> {
        let _guard = self
            .state_lock
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let mut state = self.repository.load_state()?;
        let mut sessions = sessions;
        // Sanity caps: keep the newest 100 sessions / 200 messages each.
        sessions.truncate(100);
        for session in &mut sessions {
            if session.messages.len() > 200 {
                let skip = session.messages.len() - 200;
                session.messages.drain(..skip);
            }
            if session.title.chars().count() > 120 {
                session.title = session.title.chars().take(120).collect();
            }
        }
        state.ai_sessions = sessions;
        state.active_ai_session_id = active_ai_session_id;
        self.repository.save_state(&state)?;
        Ok(state)
    }

    pub fn skip_update_version(&self, version: String) -> AppResult<AppState> {        let canonical = parse_version(&version).map(format_version).ok_or_else(|| {
            AppError::new(ErrorCode::Io, "Unable to skip this update version.")
                .with_details("Version must be major.minor.patch.")
        })?;
        let _guard = self
            .state_lock
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let mut state = self.repository.load_state()?;
        if state.skipped_update_version.as_deref() == Some(canonical.as_str()) {
            return Ok(state);
        }
        state.skipped_update_version = Some(canonical);
        self.repository.save_state(&state)?;
        Ok(state)
    }

    pub fn cloud_sync_profile(&self, workspace_root: &str) -> AppResult<CloudSyncProfile> {
        let workspace_root =
            normalize_workspace_key(workspace_root).unwrap_or_else(|_| workspace_root.to_string());
        let state = self.repository.load_state()?;
        Ok(state
            .cloud_sync
            .get(&workspace_root)
            .cloned()
            .unwrap_or_default())
    }

    pub fn save_cloud_sync_profile(
        &self,
        workspace_root: String,
        profile: CloudSyncProfile,
    ) -> AppResult<CloudSyncProfile> {
        let _guard = self
            .state_lock
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let workspace_root = normalize_workspace_key(&workspace_root)?;
        let profile = sanitize_profile(profile)?;
        let mut state = self.repository.load_state()?;
        state.cloud_sync.insert(workspace_root, profile.clone());
        self.repository.save_state(&state)?;
        Ok(profile)
    }

    pub fn drafts_exist(
        &self,
        workspace_root: &str,
        relative_paths: &[String],
    ) -> AppResult<Vec<String>> {
        let normalized =
            normalize_workspace_key(workspace_root).unwrap_or_else(|_| workspace_root.to_string());
        let mut found = self.repository.drafts_exist(&normalized, relative_paths)?;
        if normalized != workspace_root {
            found.extend(
                self.repository
                    .drafts_exist(workspace_root, relative_paths)?,
            );
        }
        found.sort();
        found.dedup();
        Ok(found)
    }

    pub fn read_draft(
        &self,
        workspace_root: &str,
        relative_path: &str,
    ) -> AppResult<Option<String>> {
        let normalized =
            normalize_workspace_key(workspace_root).unwrap_or_else(|_| workspace_root.to_string());
        let draft = self.repository.read_draft(&normalized, relative_path)?;
        if draft.is_some() || normalized == workspace_root {
            Ok(draft)
        } else {
            self.repository.read_draft(workspace_root, relative_path)
        }
    }

    pub fn write_draft(
        &self,
        workspace_root: &str,
        relative_path: &str,
        content: &str,
    ) -> AppResult<()> {
        let normalized =
            normalize_workspace_key(workspace_root).unwrap_or_else(|_| workspace_root.to_string());
        self.repository
            .write_draft(&normalized, relative_path, content)
    }

    pub fn delete_draft(&self, workspace_root: &str, relative_path: &str) -> AppResult<()> {
        let normalized =
            normalize_workspace_key(workspace_root).unwrap_or_else(|_| workspace_root.to_string());
        self.repository.delete_draft(&normalized, relative_path)?;
        if normalized != workspace_root {
            self.repository
                .delete_draft(workspace_root, relative_path)?;
        }
        Ok(())
    }

    pub fn migrate_legacy_state(&self, payload: LegacyStatePayload) -> AppResult<MigrationResult> {
        let _guard = self
            .state_lock
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let mut state = self.repository.load_state()?;
        let mut migrated_keys = Vec::new();

        if let Some(settings) = payload.settings {
            state.preferences = settings;
            migrated_keys.push("memoir:settings".into());
            migrated_keys.push("memoir:theme".into());
        }
        if let Some(workspace) = payload.last_workspace {
            let workspace = normalize_workspace_key(&workspace).unwrap_or(workspace);
            state.last_workspace = Some(workspace.clone());
            state.recent_workspaces.retain(|item| item != &workspace);
            state.recent_workspaces.insert(0, workspace);
            migrated_keys.push("memoir:last-workspace".into());
        }
        if let Some(collapsed) = payload.sidebar_collapsed {
            state.sidebar_collapsed = collapsed;
            migrated_keys.push("memoir:sidebar-collapsed".into());
        }
        if let Some(favorites) = payload.favorites {
            if let Some(root) = state.last_workspace.clone() {
                state.favorites.insert(root, favorites);
                migrated_keys.push("memoir:favorites".into());
            }
        }

        for draft in &payload.drafts {
            self.repository.write_legacy_draft(draft)?;
            migrated_keys.push(draft.legacy_key.clone());
        }

        self.repository.save_state(&state)?;
        migrated_keys.sort();
        migrated_keys.dedup();
        Ok(MigrationResult { migrated_keys })
    }

    pub fn list_note_versions(
        &self,
        workspace_root: &str,
        relative_path: &str,
    ) -> AppResult<Vec<NoteVersionMeta>> {
        let normalized =
            normalize_workspace_key(workspace_root).unwrap_or_else(|_| workspace_root.to_string());
        let mut versions = self.repository.load_note_versions(&normalized, relative_path)?;
        if normalized != workspace_root {
            versions.extend(
                self.repository
                    .load_note_versions(workspace_root, relative_path)?,
            );
        }
        versions.sort_by_key(|version| version.created_at);
        Ok(versions.iter().rev().map(note_version_meta).collect())
    }

    pub fn get_note_version(
        &self,
        workspace_root: &str,
        relative_path: &str,
        version_id: &str,
    ) -> AppResult<NoteVersion> {
        let normalized =
            normalize_workspace_key(workspace_root).unwrap_or_else(|_| workspace_root.to_string());
        let mut versions = self.repository.load_note_versions(&normalized, relative_path)?;
        if normalized != workspace_root {
            versions.extend(
                self.repository
                    .load_note_versions(workspace_root, relative_path)?,
            );
        }
        versions
            .into_iter()
            .find(|version| version.id == version_id)
            .ok_or_else(|| {
                AppError::not_found(format!("Note version {version_id} does not exist."))
            })
    }

    pub fn snapshot_note_version(
        &self,
        workspace_root: &str,
        relative_path: &str,
        old_content: &str,
        new_content: &str,
        preserve: bool,
    ) -> AppResult<()> {
        let normalized =
            normalize_workspace_key(workspace_root).unwrap_or_else(|_| workspace_root.to_string());
        let _guard = self
            .state_lock
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let mut versions = self.repository.load_note_versions(&normalized, relative_path)?;
        if versions.is_empty() && normalized != workspace_root {
            versions = self.repository.load_note_versions(workspace_root, relative_path)?;
        }
        versions.sort_by_key(|version| version.created_at);
        let latest_created_at = versions.last().map(|version| version.created_at);
        if !should_snapshot_version(
            latest_created_at,
            old_content.is_empty(),
            old_content.len(),
            new_content.len(),
            preserve,
        ) {
            return Ok(());
        }
        let now_ms = current_ms();
        let created_at = latest_created_at
            .map(|last| now_ms.max(last + 1))
            .unwrap_or(now_ms);
        let id = format!(
            "v{}",
            stable_hash(
                format!("{normalized}:{relative_path}:{created_at}:{}", old_content.len())
                    .as_bytes()
            )
        );
        versions.push(NoteVersion {
            id,
            title: parse_note(old_content, "").title,
            size: old_content.len() as u64,
            created_at,
            content: old_content.to_string(),
        });
        self.repository
            .save_note_versions(&normalized, relative_path, &versions)
    }
}

fn current_ms() -> i64 {
    i64::try_from(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_millis())
            .unwrap_or_default(),
    )
    .unwrap_or_default()
}

/// Mirrors the upstream snapshot policy: record the outgoing content when it
/// is the note's first version, when the last snapshot is older than five
/// minutes, or when the edit changes the size by at least 400 characters.
/// Restores pass `preserve` to force an unconditional snapshot.
fn should_snapshot_version(
    latest_created_at: Option<i64>,
    old_content_empty: bool,
    old_size: usize,
    new_size: usize,
    preserve: bool,
) -> bool {
    if old_content_empty {
        return false;
    }
    if preserve {
        return true;
    }
    match latest_created_at {
        None => true,
        Some(last) => {
            current_ms() - last > SNAPSHOT_INTERVAL_MS
                || (new_size as i64 - old_size as i64).abs() >= SNAPSHOT_DIFF_THRESHOLD as i64
        }
    }
}

const SNAPSHOT_INTERVAL_MS: i64 = 5 * 60 * 1000;
const SNAPSHOT_DIFF_THRESHOLD: usize = 400;

fn note_version_meta(version: &NoteVersion) -> NoteVersionMeta {
    NoteVersionMeta {
        id: version.id.clone(),
        title: version.title.clone(),
        size: version.size,
        created_at: version.created_at,
    }
}

fn validate_folder_key(folder: &str) -> AppResult<String> {
    let normalized = folder.trim().trim_matches('/').trim_matches('\\');
    if normalized.is_empty() {
        return Ok(String::new());
    }
    validate_relative_path(normalized)?;
    Ok(normalized.to_string())
}

const FOLDER_COLORS: &[&str] = &["coral", "blue", "green", "gold", "violet", "slate", "ink"];

fn sanitize_folder_appearance(appearance: Option<FolderAppearance>) -> Option<FolderAppearance> {
    let appearance = appearance?;
    let emoji = appearance.emoji.and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() || trimmed.len() > 32 || trimmed.chars().any(char::is_control) {
            None
        } else {
            Some(trimmed.to_string())
        }
    });
    let color = appearance
        .color
        .filter(|value| FOLDER_COLORS.contains(&value.as_str()));
    if emoji.is_none() && color.is_none() {
        None
    } else {
        Some(FolderAppearance { emoji, color })
    }
}
