mod application;
pub mod domain;
mod encoding;
mod infrastructure;

use tauri::Manager;

use application::{
    app_lifecycle::{MainWindowLifecycle, handle_run_event, handle_window_event},
    app_storage_commands::{
        initialize_app_storage, list_custom_backgrounds, read_custom_background,
        update_app_preferences, update_custom_backgrounds,
    },
    app_storage_runtime::AppStorageRuntime,
    attachment_commands::{
        cache_project_image, import_host_attachment, list_host_files, upload_attachment,
    },
    background_commands::{
        download_workbench_background, get_workbench_background, list_workbench_backgrounds,
    },
    catalog_commands::{
        cancel_provider_login, configure_custom_provider, get_global_settings,
        get_project_defaults, get_provider_connection, list_mcp_servers, list_models, list_skills,
        logout_provider, retry_mcp_servers, start_official_provider_login, update_global_settings,
        update_project_defaults,
    },
    commands::{
        acknowledge_runtime_events, cancel_native_request, connect_runtime, get_app_info,
        get_runtime_performance_metrics, inspect_codex_runtime, install_app_update,
        install_codex_runtime, start_runtime,
    },
    desktop_pet_commands::{
        DesktopPetRuntime, configure_desktop_pet, get_desktop_pet_drag_strategy,
        get_desktop_pet_position, get_desktop_pet_state, layout_desktop_pet, move_desktop_pet,
        open_desktop_pet_task, set_desktop_pet_drag_position, show_desktop_pet,
        start_desktop_pet_native_drag,
    },
    diagnostic_commands::{export_diagnostics, record_frontend_diagnostic},
    extension_commands::{
        get_official_plugin, install_official_plugin, list_official_plugins,
        uninstall_official_plugin,
    },
    notification_commands::NotificationRuntime,
    open_commands::{get_project_open_capabilities, open_project, open_task_attachment},
    pet_commands::{download_workbench_pet, list_workbench_pets},
    project_file_window_commands::open_project_file_window,
    prompt_submission::submit_prompt,
    scheduled_task_commands::{
        create_scheduled_task, delete_scheduled_task, list_scheduled_tasks, preview_scheduled_task,
        run_scheduled_task_now, set_scheduled_task_enabled, update_scheduled_task,
    },
    scheduled_task_runtime::ScheduledTaskRuntime,
    search_commands::{search_task_occurrences, search_tasks},
    sidebar_commands::{
        add_project, archive_task, compact_task, delete_task, get_task_settings, interrupt_turn,
        list_projects, list_tasks, pin_task, read_task, remove_project, rename_project,
        rename_task, reorder_projects, resolve_pending_request, start_task, start_turn,
        unarchive_task, update_task_settings,
    },
    sidebar_directory_commands::list_project_directories,
    skills_market_commands::{
        get_clawhub_skill, install_clawhub_skill, list_clawhub_skills, list_configured_mcp_servers,
        list_installed_skills, open_skill_directory, set_mcp_server_enabled, set_skill_enabled,
    },
    state::AppState,
    task_activity_commands::{acknowledge_task_activity, get_task_activities},
    task_board_commands::list_completed_tasks,
    task_fork_commands::fork_task,
    task_subscription_commands::{release_task_subscription, retain_task_subscription},
    task_window_commands::{
        acknowledge_task_window, close_task_window, connect_task_window, drag_task_window,
        open_task_window, restore_task_window,
    },
    temporary_workspace_commands::{
        choose_temporary_workspace_root, get_temporary_workspace_settings,
    },
    tray_commands::setup_tray,
    workflow_commands::{
        add_queued_submission, clear_task_goal, delete_queued_submission,
        list_background_terminals, list_queued_submissions, move_queued_submission,
        terminate_background_terminal, update_task_goal, upload_feedback,
    },
    workspace_commands::{
        commit_project_changes, create_project_branch, create_project_worktree,
        delete_project_file, generate_commit_message, get_project_git_commit_file_diff,
        get_project_git_commit_files, get_project_git_history, get_project_git_status,
        list_project_files, list_project_worktrees, read_project_source_file, rename_project_file,
        search_project_files, stop_project_file_search, switch_project_branch,
        switch_project_worktree,
    },
};
use infrastructure::diagnostics;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(target_os = "macos")]
    let builder = builder.plugin(tauri_nspanel::init());
    // 测试驱动只由显式 feature 注入，使 release 性能构建与正式 release 完全隔离。
    #[cfg(feature = "webview-tests")]
    let builder = builder
        .plugin(tauri_plugin_wdio::init())
        .plugin(tauri_plugin_wdio_webdriver::init());
    // WDIO 已注册全局 logger；测试构建不能再次安装正式诊断 logger。
    #[cfg(not(feature = "webview-tests"))]
    let builder = builder.plugin(diagnostics::plugin());
    let result = builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppState::default())
        .manage(AppStorageRuntime::default())
        .manage(DesktopPetRuntime::default())
        .manage(NotificationRuntime::default())
        .manage(ScheduledTaskRuntime::default())
        .manage(MainWindowLifecycle::default())
        .manage(application::terminal_lifecycle::TerminalLifecycle::default())
        .setup(|app| {
            diagnostics::initialize(app.handle())?;
            setup_tray(app.handle())?;
            if let Some(window) = app.get_webview_window("main") {
                application::terminal_lifecycle::bind_window(app.handle(), &window);
            }
            app.state::<ScheduledTaskRuntime>()
                .start(app.handle().clone());
            Ok(())
        })
        .on_window_event(handle_window_event)
        .on_page_load(|webview, payload| {
            if webview.label() == "main"
                && matches!(payload.event(), tauri::webview::PageLoadEvent::Started)
            {
                let manager = webview.state::<AppState>().terminals.clone();
                let generation = manager.generation();
                tauri::async_runtime::spawn_blocking(move || {
                    if let Err(error) = manager.close_generation(&generation) {
                        diagnostics::record_error("terminal_reload_cleanup_failed", error);
                    }
                });
            }
        })
        .invoke_handler(tauri::generate_handler![
            open_task_window,
            connect_task_window,
            acknowledge_task_window,
            close_task_window,
            restore_task_window,
            drag_task_window,
            #[cfg(feature = "webview-tests")]
            application::terminal_probe::probe_terminal_protocol,
            #[cfg(feature = "webview-tests")]
            application::terminal_probe::inspect_project_terminal_test,
            application::terminal_commands::connect_project_terminals,
            application::terminal_commands::create_project_terminal,
            application::terminal_commands::write_project_terminal,
            application::terminal_commands::resize_project_terminal,
            application::terminal_commands::ack_project_terminal,
            application::terminal_commands::close_project_terminal,
            application::terminal_commands::remove_project_terminal,
            initialize_app_storage,
            update_app_preferences,
            list_custom_backgrounds,
            read_custom_background,
            update_custom_backgrounds,
            connect_runtime,
            acknowledge_runtime_events,
            start_runtime,
            inspect_codex_runtime,
            install_codex_runtime,
            cancel_native_request,
            get_app_info,
            install_app_update,
            get_runtime_performance_metrics,
            record_frontend_diagnostic,
            export_diagnostics,
            get_temporary_workspace_settings,
            choose_temporary_workspace_root,
            get_task_activities,
            acknowledge_task_activity,
            release_task_subscription,
            retain_task_subscription,
            configure_desktop_pet,
            get_desktop_pet_state,
            get_desktop_pet_drag_strategy,
            get_desktop_pet_position,
            show_desktop_pet,
            set_desktop_pet_drag_position,
            start_desktop_pet_native_drag,
            move_desktop_pet,
            layout_desktop_pet,
            open_desktop_pet_task,
            get_workbench_background,
            list_workbench_backgrounds,
            download_workbench_background,
            list_workbench_pets,
            download_workbench_pet,
            list_models,
            get_provider_connection,
            start_official_provider_login,
            cancel_provider_login,
            configure_custom_provider,
            logout_provider,
            get_global_settings,
            application::personalization_commands::get_global_instructions,
            application::personalization_commands::save_global_instructions,
            application::personalization_commands::get_memory_settings,
            application::personalization_commands::update_memory_settings,
            application::personalization_commands::reset_memories,
            update_global_settings,
            get_project_defaults,
            update_project_defaults,
            list_skills,
            list_installed_skills,
            list_configured_mcp_servers,
            open_skill_directory,
            set_skill_enabled,
            set_mcp_server_enabled,
            list_clawhub_skills,
            get_clawhub_skill,
            install_clawhub_skill,
            list_official_plugins,
            get_official_plugin,
            install_official_plugin,
            uninstall_official_plugin,
            list_mcp_servers,
            retry_mcp_servers,
            list_projects,
            add_project,
            rename_project,
            remove_project,
            reorder_projects,
            list_project_directories,
            list_completed_tasks,
            list_scheduled_tasks,
            preview_scheduled_task,
            create_scheduled_task,
            update_scheduled_task,
            delete_scheduled_task,
            set_scheduled_task_enabled,
            run_scheduled_task_now,
            list_tasks,
            search_tasks,
            search_task_occurrences,
            read_task,
            start_task,
            start_turn,
            submit_prompt,
            application::steer_submission::steer_turn,
            interrupt_turn,
            resolve_pending_request,
            application::review_submission::submit_review,
            compact_task,
            fork_task,
            get_task_settings,
            update_task_settings,
            update_task_goal,
            clear_task_goal,
            upload_feedback,
            list_background_terminals,
            terminate_background_terminal,
            list_queued_submissions,
            add_queued_submission,
            delete_queued_submission,
            move_queued_submission,
            application::queue_start::start_queued_submission,
            list_project_files,
            search_project_files,
            stop_project_file_search,
            rename_project_file,
            delete_project_file,
            open_project_file_window,
            read_project_source_file,
            get_project_git_status,
            get_project_git_history,
            get_project_git_commit_files,
            get_project_git_commit_file_diff,
            switch_project_branch,
            create_project_branch,
            list_project_worktrees,
            create_project_worktree,
            switch_project_worktree,
            generate_commit_message,
            commit_project_changes,
            upload_attachment,
            import_host_attachment,
            cache_project_image,
            list_host_files,
            get_project_open_capabilities,
            open_project,
            open_task_attachment,
            rename_task,
            pin_task,
            archive_task,
            unarchive_task,
            delete_task
        ])
        .build(tauri::generate_context!());

    let app = match result {
        Ok(app) => app,
        Err(error) => {
            eprintln!("failed to build Codexly: {error}");
            return;
        }
    };
    app.run(|app, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            diagnostics::mark_clean_shutdown(app);
        }
        handle_run_event(app, event);
    });
}
