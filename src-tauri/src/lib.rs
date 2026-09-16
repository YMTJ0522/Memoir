mod commands;
mod domain;
mod infrastructure;
mod services;
#[cfg(test)]
mod tests;
mod tray;
mod window_frame;

use commands::{
    chat_completion, chat_completion_stream, check_app_update, create_note, delete_attachment,
    delete_draft, delete_note, drafts_exist, empty_trash, export_pdf, fetch_link_preview_html,
    get_cloud_sync_profile, get_index_info, get_note_graph, get_note_version, import_attachment,
    import_note, list_note_versions, list_trash, load_app_state, migrate_legacy_state,
    purge_trash_item, query_library, read_draft, read_import_source, read_note, rebuild_index,
    reconcile_workspace, rename_note, restore_trash_item, run_cloud_sync, save_ai_sessions,
    save_attachment, save_cloud_sync_profile, save_preferences, scan_attachments, set_favorite,
    set_folder_appearance, skip_app_update, snapshot_note_version, test_ai_connection,
    test_cloud_sync, web_search, write_debug_log, write_draft, write_export_file, write_note,
    AppServices,
};
use infrastructure::{app_data::AppDataRepository, filesystem::LocalFileSystem};
use services::{AppStateService, CloudSyncService, WorkspaceService};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // A second instance was launched: focus the existing main window
            // instead of spawning another one. This matters because two
            // processes would fight over the same app-state.json and the
            // frameless transparent windows visually stack on top of each
            // other.
            tray::show_main(app);
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()?;
            let app_data = AppDataRepository::new(app_data_dir);
            let app_state = AppStateService::new(app_data.clone());
            let filesystem = LocalFileSystem::new();
            let workspace = WorkspaceService::new(filesystem.clone());
            if let Some(window) = app.get_webview_window("main") {
                let frame = app_state
                    .load()
                    .map(|state| state.window)
                    .unwrap_or_default();
                window_frame::restore(&window, &frame);
                window_frame::persist_on_changes(window.clone(), app_state.clone(), frame.clone());
                window_frame::reveal(&window, frame.maximized);
            }
            let close_policy = tray::install(app, &app_state)?;
            app.manage(close_policy);
            app.manage(AppServices {
                workspace: workspace.clone(),
                cloud_sync: CloudSyncService::new(
                    filesystem,
                    app_state.clone(),
                    app_data,
                    workspace,
                ),
                app_state,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            reconcile_workspace,
            query_library,
            get_index_info,
            get_note_graph,
            rebuild_index,
            read_note,
            write_note,
            create_note,
            read_import_source,
            import_note,
            rename_note,
            delete_note,
            scan_attachments,
            drafts_exist,
            save_attachment,
            import_attachment,
            delete_attachment,
            list_trash,
            restore_trash_item,
            purge_trash_item,
            empty_trash,
            load_app_state,
            check_app_update,
            skip_app_update,
            save_preferences,
            set_favorite,
            set_folder_appearance,
            read_draft,
            write_draft,
            delete_draft,
            list_note_versions,
            get_note_version,
            snapshot_note_version,
            migrate_legacy_state,
            write_export_file,
            get_cloud_sync_profile,
            save_cloud_sync_profile,
            test_cloud_sync,
            run_cloud_sync,
            fetch_link_preview_html,
            web_search,
            chat_completion,
            chat_completion_stream,
            save_ai_sessions,
            test_ai_connection,
            export_pdf,
            write_debug_log
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen {
                has_visible_windows: false,
                ..
            } = event
            {
                tray::show_main(&app);
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app, event);
        });
}
