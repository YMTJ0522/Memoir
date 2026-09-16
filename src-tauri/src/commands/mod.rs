use crate::{
    domain::{
        attachment::ATTACHMENTS_DIR, AppError, AppSettings, AppState, AppUpdateCheck,
        AttachmentFile, CloudSyncProbe, CloudSyncProfile, CloudSyncRunResult, FolderAppearance,
        LegacyStatePayload, LibraryPage, LibraryQuery, MigrationResult, NoteFile, NoteGraph,
        NoteVersion, NoteVersionMeta, RenamedNote, TrashEntry, WorkspaceIndexInfo, WorkspaceLayout,
    },
    infrastructure::{ai_client, github_releases, link_preview, web_search},
    services::{AppStateService, CloudSyncService, WorkspaceService},
    tray::ClosePolicy,
};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};

fn allow_workspace_media(app: &AppHandle, root: &str) {
    let path = PathBuf::from(root);
    let canonical = path.canonicalize().unwrap_or(path);
    let path = dunce::simplified(&canonical).to_path_buf();
    let scope = app.asset_protocol_scope();
    let _ = scope.allow_directory(&path, true);
    let _ = scope.allow_directory(path.join(ATTACHMENTS_DIR), true);
}

#[derive(Debug, Clone)]
pub struct AppServices {
    pub workspace: WorkspaceService,
    pub app_state: AppStateService,
    pub cloud_sync: CloudSyncService,
}

#[tauri::command]
pub async fn reconcile_workspace(
    app: AppHandle,
    services: State<'_, AppServices>,
    root: String,
    query: Option<LibraryQuery>,
) -> Result<LibraryPage, AppError> {
    allow_workspace_media(&app, &root);
    let workspace = services.workspace.clone();
    let query = query.unwrap_or_default();
    tauri::async_runtime::spawn_blocking(move || workspace.reconcile(&root, &query))
        .await
        .map_err(|error| {
            AppError::new(
                crate::domain::ErrorCode::Io,
                "Workspace reconcile interrupted.",
            )
            .with_details(error.to_string())
        })?
}

#[tauri::command]
pub async fn query_library(
    services: State<'_, AppServices>,
    root: String,
    query: LibraryQuery,
) -> Result<LibraryPage, AppError> {
    let workspace = services.workspace.clone();
    tauri::async_runtime::spawn_blocking(move || workspace.query_library(&root, &query))
        .await
        .map_err(|error| {
            AppError::new(crate::domain::ErrorCode::Io, "Library query interrupted.")
                .with_details(error.to_string())
        })?
}

#[tauri::command]
pub fn read_note(
    services: State<'_, AppServices>,
    root: String,
    relative_path: String,
) -> Result<String, AppError> {
    services.workspace.read(&root, &relative_path)
}

#[tauri::command]
pub fn write_note(
    services: State<'_, AppServices>,
    root: String,
    relative_path: String,
    content: String,
) -> Result<NoteFile, AppError> {
    services.workspace.write(&root, &relative_path, &content)
}

#[tauri::command]
pub fn create_note(
    services: State<'_, AppServices>,
    root: String,
    title: String,
    extension: String,
    folder: Option<String>,
    tags: Option<Vec<String>>,
) -> Result<NoteFile, AppError> {
    services.workspace.create(
        &root,
        &title,
        &extension,
        folder.as_deref(),
        tags.as_deref(),
    )
}

/// Reads a local file selected by the "import article" flow: UTF-8/GBK text
/// plus raw bytes (base64) for formats the webview converts (docx).
#[tauri::command]
pub fn read_import_source(
    services: State<'_, AppServices>,
    source_path: String,
) -> Result<crate::domain::import_source::ImportSourcePayload, AppError> {
    Ok(crate::domain::import_source::read_import_source(&source_path)?.into_payload())
}

/// Writes one converted article as a new note (frontmatter + markdown body).
#[tauri::command]
pub fn import_note(
    app: AppHandle,
    services: State<'_, AppServices>,
    root: String,
    title: String,
    markdown: String,
    folder: Option<String>,
) -> Result<NoteFile, AppError> {
    allow_workspace_media(&app, &root);
    services
        .workspace
        .import_note(&root, &title, &markdown, folder.as_deref())
}

#[tauri::command]
pub fn rename_note(
    services: State<'_, AppServices>,
    root: String,
    old_relative_path: String,
    new_relative_path: String,
) -> Result<RenamedNote, AppError> {
    services
        .workspace
        .rename(&root, &old_relative_path, &new_relative_path)
}

#[tauri::command]
pub fn delete_note(
    services: State<'_, AppServices>,
    root: String,
    relative_path: String,
) -> Result<String, AppError> {
    services.workspace.delete(&root, &relative_path)
}

#[tauri::command]
pub async fn get_index_info(
    services: State<'_, AppServices>,
    root: String,
) -> Result<WorkspaceIndexInfo, AppError> {
    let workspace = services.workspace.clone();
    tauri::async_runtime::spawn_blocking(move || workspace.index_info(&root))
        .await
        .map_err(|error| {
            AppError::new(crate::domain::ErrorCode::Io, "Index info interrupted.")
                .with_details(error.to_string())
        })?
}

#[tauri::command]
pub async fn rebuild_index(
    services: State<'_, AppServices>,
    root: String,
    query: Option<LibraryQuery>,
) -> Result<LibraryPage, AppError> {
    let workspace = services.workspace.clone();
    let query = query.unwrap_or_default();
    tauri::async_runtime::spawn_blocking(move || workspace.rebuild_index(&root, &query))
        .await
        .map_err(|error| {
            AppError::new(crate::domain::ErrorCode::Io, "Index rebuild interrupted.")
                .with_details(error.to_string())
        })?
}

#[tauri::command]
pub async fn get_note_graph(
    services: State<'_, AppServices>,
    root: String,
) -> Result<NoteGraph, AppError> {
    let workspace = services.workspace.clone();
    tauri::async_runtime::spawn_blocking(move || workspace.note_graph(&root))
        .await
        .map_err(|error| {
            AppError::new(crate::domain::ErrorCode::Io, "Note graph interrupted.")
                .with_details(error.to_string())
        })?
}

#[tauri::command]
pub async fn scan_attachments(
    app: AppHandle,
    services: State<'_, AppServices>,
    root: String,
) -> Result<Vec<AttachmentFile>, AppError> {
    allow_workspace_media(&app, &root);
    let workspace = services.workspace.clone();
    tauri::async_runtime::spawn_blocking(move || workspace.scan_attachments(&root))
        .await
        .map_err(|error| {
            AppError::new(crate::domain::ErrorCode::Io, "Attachment scan interrupted.")
                .with_details(error.to_string())
        })?
}

#[tauri::command]
pub fn drafts_exist(
    services: State<'_, AppServices>,
    workspace_root: String,
    relative_paths: Vec<String>,
) -> Result<Vec<String>, AppError> {
    services
        .app_state
        .drafts_exist(&workspace_root, &relative_paths)
}

#[tauri::command]
pub async fn save_attachment(
    app: AppHandle,
    services: State<'_, AppServices>,
    root: String,
    bytes_base64: String,
    file_name: Option<String>,
    mime_type: Option<String>,
) -> Result<AttachmentFile, AppError> {
    allow_workspace_media(&app, &root);
    let workspace = services.workspace.clone();
    tauri::async_runtime::spawn_blocking(move || {
        workspace.save_attachment(
            &root,
            &bytes_base64,
            file_name.as_deref(),
            mime_type.as_deref(),
        )
    })
    .await
    .map_err(|error| {
        AppError::new(
            crate::domain::ErrorCode::Io,
            "Attachment save interrupted.",
        )
        .with_details(error.to_string())
    })?
}

#[tauri::command]
pub async fn import_attachment(
    app: AppHandle,
    services: State<'_, AppServices>,
    root: String,
    source_path: String,
) -> Result<AttachmentFile, AppError> {
    allow_workspace_media(&app, &root);
    let workspace = services.workspace.clone();
    tauri::async_runtime::spawn_blocking(move || workspace.import_attachment(&root, &source_path))
        .await
        .map_err(|error| {
            AppError::new(
                crate::domain::ErrorCode::Io,
                "Attachment import interrupted.",
            )
            .with_details(error.to_string())
        })?
}

#[tauri::command]
pub fn delete_attachment(
    services: State<'_, AppServices>,
    root: String,
    relative_path: String,
) -> Result<String, AppError> {
    services.workspace.delete_attachment(&root, &relative_path)
}

#[tauri::command]
pub fn list_trash(
    services: State<'_, AppServices>,
    root: String,
) -> Result<Vec<TrashEntry>, AppError> {
    services.workspace.list_trash(&root)
}

#[tauri::command]
pub fn restore_trash_item(
    app: AppHandle,
    services: State<'_, AppServices>,
    root: String,
    trash_name: String,
) -> Result<String, AppError> {
    allow_workspace_media(&app, &root);
    services.workspace.restore_trash_item(&root, &trash_name)
}

#[tauri::command]
pub fn purge_trash_item(
    services: State<'_, AppServices>,
    root: String,
    trash_name: String,
) -> Result<(), AppError> {
    services.workspace.purge_trash_item(&root, &trash_name)
}

#[tauri::command]
pub fn empty_trash(services: State<'_, AppServices>, root: String) -> Result<(), AppError> {
    services.workspace.empty_trash(&root)
}

#[tauri::command]
pub fn write_export_file(
    services: State<'_, AppServices>,
    path: String,
    bytes_base64: String,
) -> Result<(), AppError> {
    services.workspace.write_export_file(&path, &bytes_base64)
}

#[tauri::command]
pub fn load_app_state(services: State<'_, AppServices>) -> Result<AppState, AppError> {
    services.app_state.load()
}

#[tauri::command]
pub async fn check_app_update(
    services: State<'_, AppServices>,
) -> Result<AppUpdateCheck, AppError> {
    let app_state = services.app_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let skipped = app_state.load()?.skipped_update_version;
        let release = github_releases::fetch_latest_release()?;
        Ok(crate::domain::build_update_check(
            env!("CARGO_PKG_VERSION"),
            skipped.as_deref(),
            &release.tag_name,
            &release.html_url,
            release.body.as_deref(),
        ))
    })
    .await
    .map_err(|error| {
        AppError::new(crate::domain::ErrorCode::Io, "Unable to check for updates.")
            .with_details(error.to_string())
    })?
}

#[tauri::command]
pub fn skip_app_update(
    services: State<'_, AppServices>,
    version: String,
) -> Result<AppState, AppError> {
    services.app_state.skip_update_version(version)
}

#[tauri::command]
pub fn save_preferences(
    app: AppHandle,
    services: State<'_, AppServices>,
    close_policy: State<'_, Arc<ClosePolicy>>,
    preferences: AppSettings,
    last_workspace: Option<String>,
    sidebar_collapsed: bool,
    layout: Option<WorkspaceLayout>,
) -> Result<AppState, AppError> {
    let state = services.app_state.save_preferences(
        preferences,
        last_workspace,
        sidebar_collapsed,
        layout,
    )?;
    crate::tray::sync_from_preferences(&app, &state.preferences, close_policy.as_ref());
    Ok(state)
}

#[tauri::command]
pub fn set_favorite(
    services: State<'_, AppServices>,
    workspace_root: String,
    relative_path: String,
    favorite: bool,
) -> Result<AppState, AppError> {
    services
        .app_state
        .set_favorite(workspace_root, relative_path, favorite)
}

#[tauri::command]
pub fn set_folder_appearance(
    services: State<'_, AppServices>,
    workspace_root: String,
    folder: String,
    appearance: Option<FolderAppearance>,
) -> Result<AppState, AppError> {
    services
        .app_state
        .set_folder_appearance(workspace_root, folder, appearance)
}

#[tauri::command]
pub fn read_draft(
    services: State<'_, AppServices>,
    workspace_root: String,
    relative_path: String,
) -> Result<Option<String>, AppError> {
    services
        .app_state
        .read_draft(&workspace_root, &relative_path)
}

#[tauri::command]
pub fn write_draft(
    services: State<'_, AppServices>,
    workspace_root: String,
    relative_path: String,
    content: String,
) -> Result<(), AppError> {
    services
        .app_state
        .write_draft(&workspace_root, &relative_path, &content)
}

#[tauri::command]
pub fn delete_draft(
    services: State<'_, AppServices>,
    workspace_root: String,
    relative_path: String,
) -> Result<(), AppError> {
    services
        .app_state
        .delete_draft(&workspace_root, &relative_path)
}

#[tauri::command]
pub fn list_note_versions(
    services: State<'_, AppServices>,
    workspace_root: String,
    relative_path: String,
) -> Result<Vec<NoteVersionMeta>, AppError> {
    services
        .app_state
        .list_note_versions(&workspace_root, &relative_path)
}

#[tauri::command]
pub fn get_note_version(
    services: State<'_, AppServices>,
    workspace_root: String,
    relative_path: String,
    version_id: String,
) -> Result<NoteVersion, AppError> {
    services
        .app_state
        .get_note_version(&workspace_root, &relative_path, &version_id)
}

#[tauri::command]
pub fn snapshot_note_version(
    services: State<'_, AppServices>,
    workspace_root: String,
    relative_path: String,
    old_content: String,
    new_content: String,
    preserve: Option<bool>,
) -> Result<(), AppError> {
    services.app_state.snapshot_note_version(
        &workspace_root,
        &relative_path,
        &old_content,
        &new_content,
        preserve.unwrap_or(false),
    )
}

#[tauri::command]
pub fn get_cloud_sync_profile(
    services: State<'_, AppServices>,
    workspace_root: String,
) -> Result<CloudSyncProfile, AppError> {
    services.cloud_sync.profile(&workspace_root)
}

#[tauri::command]
pub fn save_cloud_sync_profile(
    services: State<'_, AppServices>,
    workspace_root: String,
    profile: CloudSyncProfile,
) -> Result<CloudSyncProfile, AppError> {
    services.cloud_sync.save_profile(&workspace_root, profile)
}

#[tauri::command]
pub async fn test_cloud_sync(
    services: State<'_, AppServices>,
    profile: CloudSyncProfile,
) -> Result<CloudSyncProbe, AppError> {
    let cloud_sync = services.cloud_sync.clone();
    tauri::async_runtime::spawn_blocking(move || cloud_sync.test_connection(profile))
        .await
        .map_err(|error| {
            AppError::new(
                crate::domain::ErrorCode::Io,
                "Cloud connection test interrupted.",
            )
            .with_details(error.to_string())
        })?
}

#[tauri::command]
pub async fn run_cloud_sync(
    app: AppHandle,
    services: State<'_, AppServices>,
    workspace_root: String,
    profile: Option<CloudSyncProfile>,
) -> Result<CloudSyncRunResult, AppError> {
    let cloud_sync = services.cloud_sync.clone();
    tauri::async_runtime::spawn_blocking(move || {
        cloud_sync.run_sync(
            &workspace_root,
            profile,
            Some(Arc::new(move |progress| {
                let _ = app.emit(crate::domain::CLOUD_SYNC_PROGRESS_EVENT, progress);
            })),
        )
    })
    .await
    .map_err(|error| {
        AppError::new(crate::domain::ErrorCode::Io, "Cloud sync interrupted.")
            .with_details(error.to_string())
    })?
}

#[tauri::command]
pub fn migrate_legacy_state(
    services: State<'_, AppServices>,
    payload: LegacyStatePayload,
) -> Result<MigrationResult, AppError> {
    services.app_state.migrate_legacy_state(payload)
}

#[tauri::command]
pub async fn fetch_link_preview_html(url: String) -> Result<String, AppError> {
    tauri::async_runtime::spawn_blocking(move || link_preview::fetch_html(&url))
        .await
        .map_err(|error| {
            AppError::new(crate::domain::ErrorCode::Io, "Link preview interrupted.")
                .with_details(error.to_string())
        })?
}

#[tauri::command]
pub async fn web_search(query: String) -> Result<Vec<serde_json::Value>, AppError> {
    let results = tauri::async_runtime::spawn_blocking(move || web_search::web_search(&query))
        .await
        .map_err(|error| {
            AppError::new(crate::domain::ErrorCode::Io, "Web search interrupted.")
                .with_details(error.to_string())
        })??;
    Ok(results
        .into_iter()
        .map(|r| {
            serde_json::json!({
                "title": r.title,
                "url": r.url,
                "snippet": r.snippet,
            })
        })
        .collect())
}

/// OpenAI-compatible chat completion, driven by the user's AI settings.
#[tauri::command]
pub async fn chat_completion(
    services: State<'_, AppServices>,
    input: ai_client::AiChatCompletionInput,
) -> Result<String, AppError> {
    let ai = services.app_state.load()?.preferences.ai;
    tauri::async_runtime::spawn_blocking(move || ai_client::chat_completion(&ai, &input))
        .await
        .map_err(|error| {
            AppError::new(crate::domain::ErrorCode::Io, "AI chat interrupted.")
                .with_details(error.to_string())
        })?
}

/// Streaming chat completion. Emits `ai-chat-delta` events (content) and
/// `ai-chat-reasoning` events (thinking trace) to the given window while
/// the reply is being generated; returns the final combined reply.
#[tauri::command]
pub async fn chat_completion_stream(
    app: AppHandle,
    window: tauri::WebviewWindow,
    services: State<'_, AppServices>,
    request_id: String,
    input: ai_client::AiChatCompletionInput,
) -> Result<ai_client::AiChatReplyPayload, AppError> {
    let ai = services.app_state.load()?.preferences.ai;
    let app_for_thread = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let window_label = window.label().to_string();
        let emit_delta = |piece: &str| {
            let _ = app_for_thread.emit_to(
                &window_label,
                "ai-chat-delta",
                StreamEvent {
                    request_id: request_id.clone(),
                    piece: piece.to_string(),
                },
            );
        };
        let emit_reasoning = |piece: &str| {
            let _ = app_for_thread.emit_to(
                &window_label,
                "ai-chat-reasoning",
                StreamEvent {
                    request_id: request_id.clone(),
                    piece: piece.to_string(),
                },
            );
        };
        let reply = ai_client::chat_completion_stream(&ai, &input, emit_delta, emit_reasoning)?;
        Ok(ai_client::AiChatReplyPayload::from(reply))
    })
    .await
    .map_err(|error| {
        AppError::new(crate::domain::ErrorCode::Io, "AI chat interrupted.")
            .with_details(error.to_string())
    })?
}

/// Payload streamed back to the frontend when a streaming chat finishes.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct StreamEvent {
    request_id: String,
    piece: String,
}

/// Persists AI chat sessions (chat history across restarts).
#[tauri::command]
pub fn save_ai_sessions(
    services: State<'_, AppServices>,
    sessions: Vec<crate::domain::AiSessionRecord>,
    active_ai_session_id: Option<String>,
) -> Result<(), AppError> {
    services
        .app_state
        .save_ai_sessions(sessions, active_ai_session_id)
        .map(|_| ())
}

/// Validates AI settings and (optionally) sends a minimal probe request.
#[tauri::command]
pub async fn test_ai_connection(
    services: State<'_, AppServices>,
) -> Result<String, AppError> {
    let ai = services.app_state.load()?.preferences.ai;
    tauri::async_runtime::spawn_blocking(move || {
        ai_client::validate_config(&ai)?;
        let probe = ai_client::AiChatCompletionInput {
            messages: vec![ai_client::AiChatMessage::plain("user", "ping")],
            temperature: None,
            tools: None,
            tool_choice: None,
        };
        ai_client::chat_completion(&ai, &probe)
    })
    .await
    .map_err(|error| {
        AppError::new(crate::domain::ErrorCode::Io, "AI connection test interrupted.")
            .with_details(error.to_string())
    })?
}

/// Exports an HTML document to a real vector PDF by driving the system's
/// Edge or Chrome browser in headless mode. Unlike html2canvas (which embeds
/// a rasterised screenshot), this produces selectable/copyable text and stays
/// sharp at any zoom level.
#[tauri::command]
pub async fn export_pdf(
    html: String,
    output_path: String,
) -> Result<(), AppError> {
    use std::process::Command;

    // Write the HTML to a temp file so the browser can load it via file://
    // (data: URLs hit length limits on large documents).
    let temp_dir = std::env::temp_dir();
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let temp_name = format!("memoir_pdf_{}_{}.html", std::process::id(), timestamp);
    let temp_file = temp_dir.join(&temp_name);
    std::fs::write(&temp_file, &html).map_err(|error| {
        AppError::new(crate::domain::ErrorCode::Io, "Failed to write temp HTML for PDF export.")
            .with_details(error.to_string())
    })?;

    let file_url = format!(
        "file:///{}",
        temp_file.to_string_lossy().replace('\\', "/")
    );

    let browser_path = match find_pdf_browser() {
        Some(path) => path,
        None => {
            let _ = std::fs::remove_file(&temp_file);
            return Err(AppError::new(
                crate::domain::ErrorCode::Io,
                "Could not find Microsoft Edge or Google Chrome for PDF export.",
            ));
        }
    };

    let temp_file_clone = temp_file.clone();
    let output_path_clone = output_path.clone();
    let file_url_clone = file_url.clone();

    // A separate user-data-dir prevents the headless instance from colliding
    // with an already-running Edge/Chrome profile (which would otherwise make
    // --headless silently no-op or open a normal window).
    let user_data_dir = temp_dir.join(format!("memoir_pdf_profile_{}_{}", std::process::id(), timestamp));
    let user_data_dir_clone = user_data_dir.clone();

    let result = tauri::async_runtime::spawn_blocking(move || {
        // Drive Edge through PowerShell so argument quoting matches the
        // manually-tested command line exactly (std::process::Command on
        // Windows can mangle paths that contain backslashes).
        let ps_command = format!(
            "& '{}' --user-data-dir='{}' --headless=new --disable-gpu --no-sandbox --allow-file-access-from-files --disable-extensions --disable-features=Translate --no-pdf-header-footer --virtual-time-budget=10000 --print-to-pdf='{}' '{}'",
            browser_path.display(),
            user_data_dir_clone.display(),
            output_path_clone,
            file_url_clone
        );

        let output = Command::new("powershell")
            .arg("-NoProfile")
            .arg("-NonInteractive")
            .arg("-Command")
            .arg(&ps_command)
            .output();

        let _ = std::fs::remove_file(&temp_file_clone);
        let _ = std::fs::remove_dir_all(&user_data_dir_clone);

        match output {
            Ok(out) if out.status.success() => Ok(()),
            Ok(out) => Err(AppError::new(
                crate::domain::ErrorCode::Io,
                "Browser PDF export failed.",
            )
            .with_details(String::from_utf8_lossy(&out.stderr).to_string())),
            Err(error) => Err(AppError::new(
                crate::domain::ErrorCode::Io,
                "Failed to launch browser for PDF export.",
            )
            .with_details(error.to_string())),
        }
    })
    .await
    .map_err(|error| {
        AppError::new(crate::domain::ErrorCode::Io, "PDF export task panicked.")
            .with_details(error.to_string())
    })?;

    result
}

/// Write a debug log line to the desktop. Used by the frontend to diagnose
/// export issues without requiring DevTools.
#[tauri::command]
pub async fn write_debug_log(message: String) -> Result<(), AppError> {
    let desktop = std::env::var("USERPROFILE")
        .map(|p| std::path::PathBuf::from(p).join("Desktop"))
        .unwrap_or_else(|_| std::env::temp_dir());
    let log_path = desktop.join("memoir-debug.log");
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let line = format!("[{}] {}\n", timestamp, message);
    std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .and_then(|mut f| {
            use std::io::Write;
            f.write_all(line.as_bytes())
        })
        .map_err(|error| {
            AppError::new(crate::domain::ErrorCode::Io, "Failed to write debug log.")
                .with_details(error.to_string())
        })?;
    Ok(())
}

/// Locate a Chromium-based browser that supports --headless --print-to-pdf.
/// Edge is preferred because it ships with Windows.
fn find_pdf_browser() -> Option<std::path::PathBuf> {
    let candidates = [
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    ];
    for candidate in &candidates {
        let path = std::path::Path::new(candidate);
        if path.exists() {
            return Some(path.to_path_buf());
        }
    }
    None
}
