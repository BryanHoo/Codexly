use application::prompt_optimization_commands::optimize_prompt;
mod application;
pub mod domain;
mod encoding;
mod infrastructure;

// 原生出站 HTTP 与 Web 服务端保持相同的产品标识。
pub(crate) const HTTP_USER_AGENT: &str = "Codexly";

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
    autostart_commands::enable_autostart,
    background_commands::{
        download_workbench_background, get_workbench_background, list_workbench_backgrounds,
    },
    commands::{
        acknowledge_runtime_events, cancel_native_request, connect_runtime, get_app_info,
        get_runtime_performance_metrics, install_app_update,
    },
    conversation_export_commands::save_conversation_export,
    desktop_pet_commands::{
        DesktopPetRuntime, configure_desktop_pet, get_desktop_pet_drag_strategy,
        get_desktop_pet_position, get_desktop_pet_state, layout_desktop_pet, move_desktop_pet,
        open_desktop_pet_task, set_desktop_pet_drag_position, show_desktop_pet,
        start_desktop_pet_native_drag,
    },
    diagnostic_commands::{export_diagnostics, record_frontend_diagnostic},
    notification_commands::NotificationRuntime,
    open_commands::{get_project_open_capabilities, open_project, open_task_attachment},
    pet_commands::{download_workbench_pet, list_workbench_pets},
    project_file_window_commands::open_project_file_window,
    project_pdf_commands::get_project_pdf_file,
    scheduled_task_commands::{
        create_scheduled_task, delete_scheduled_task, list_scheduled_tasks, preview_scheduled_task,
        read_acp_scheduled_config, run_scheduled_task_now, set_acp_scheduled_config,
        set_scheduled_task_enabled, update_scheduled_task,
    },
    scheduled_task_runtime::ScheduledTaskRuntime,
    search_commands::{search_task_occurrences, search_tasks},
    sidebar_commands::{
        add_project, list_projects, list_tasks, pin_task, remove_project, rename_project,
        rename_task, reorder_projects, resolve_pending_request, start_task,
    },
    sidebar_directory_commands::{create_project_directory, list_project_directories},
    state::AppState,
    task_activity_commands::{acknowledge_task_activity, get_task_activities},
    task_board_commands::list_completed_tasks,
    temporary_workspace_commands::{
        choose_temporary_workspace_root, get_temporary_workspace_settings,
    },
    text_file_commands::{
        read_project_text_file, read_project_text_file_revision, save_project_text_file,
    },
    tray_commands::setup_tray,
    tray_visibility_commands::{get_tray_icon_visible, set_tray_icon_visible},
    workspace_commands::{
        commit_project_changes, create_project_branch, delete_project_file,
        generate_commit_message, get_project_git_commit_file_diff, get_project_git_commit_files,
        get_project_git_history, get_project_git_status, list_project_files,
        list_project_worktrees, push_project_commits, read_project_source_file,
        rename_project_file, search_project_files, stop_project_file_search, switch_project_branch,
    },
    workspace_discard_commands::discard_project_changes,
    workspace_file_creation_commands::create_project_file,
};
use infrastructure::diagnostics;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(windows)]
    if diagnostics::observer_entry() {
        return;
    }
    diagnostics::install_panic_hook();
    let context = tauri::generate_context!();
    #[cfg(windows)]
    diagnostics::bootstrap_windows(&context.config().identifier);
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
    let mut updater_headers = tauri::http::HeaderMap::new();
    updater_headers.insert(
        tauri::http::header::USER_AGENT,
        tauri::http::HeaderValue::from_static(HTTP_USER_AGENT),
    );
    let result = builder
        // 仅注册系统登录启动能力，由设置开关显式启用；LaunchAgent 兼容旧版 macOS。
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_updater::Builder::new()
                .headers(updater_headers)
                .build(),
        )
        .manage(AppState::default())
        .manage(AppStorageRuntime::default())
        .manage(DesktopPetRuntime::default())
        .manage(NotificationRuntime::default())
        .manage(ScheduledTaskRuntime::default())
        .manage(application::acp_plan_runtime::AcpPlanRuntime::default())
        .manage(MainWindowLifecycle::default())
        .manage(application::terminal_lifecycle::TerminalLifecycle::default())
        .setup(|app| {
            diagnostics::initialize(app.handle())?;
            // 业务入口开放前在阻塞池执行一次迁移；运行阶段不扫描旧目录、不持有迁移锁。
            let storage_app = app.handle().clone();
            tauri::async_runtime::block_on(tauri::async_runtime::spawn_blocking(move || {
                infrastructure::app_data::initialize(&storage_app)
            }))??;
            // 首个设置查询、聊天回合和计划任务都能读取已提交的应用指令。
            if tauri::async_runtime::block_on(
                application::application_preferences_commands::migrate_global_instructions(
                    app.handle(),
                ),
            )
            .is_err()
            {
                diagnostics::record_error(
                    "global_instructions_migration_failed",
                    "旧全局指令导入失败，原文件已保留",
                );
            }
            infrastructure::network_proxy::initialize(&infrastructure::app_data::directory(
                app.handle(),
            )?)?;
            application::notification_delivery::initialize(app.handle());
            setup_tray(app.handle())?;
            if let Some(window) = app.get_webview_window("main") {
                application::terminal_lifecycle::bind_window(app.handle(), &window);
            }
            app.state::<ScheduledTaskRuntime>()
                .start(app.handle().clone());
            tauri::async_runtime::block_on(
                app.state::<application::acp_plan_runtime::AcpPlanRuntime>()
                    .start(app.handle().clone()),
            );
            Ok(())
        })
        .on_window_event(|window, event| {
            #[cfg(windows)]
            if matches!(event, tauri::WindowEvent::Destroyed) {
                windows_process_platform::diagnostics::forget_webview(window.label());
            }
            handle_window_event(window, event);
        })
        .on_page_load(|webview, payload| {
            #[cfg(windows)]
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Started) {
                diagnostics::observe_webview(webview);
            }
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
        .register_asynchronous_uri_scheme_protocol(
            "task-attachment",
            |context, request, responder| {
                let app = context.app_handle().clone();
                tauri::async_runtime::spawn(async move {
                    responder.respond(application::acp_attachments::respond(&app, request).await);
                });
            },
        )
        .invoke_handler(tauri::generate_handler![
            application::acp_plan_commands::acp_plan_request,
            application::application_preferences_commands::application_preferences_request,
            application::acp_commands::read_acp_agent,
            application::acp_commands::acp_agent_request,
            application::acp_task_commands::acp_task_request,
            application::acp_task_commands::create_acp_task,
            application::network_proxy_commands::read_network_proxy,
            application::network_proxy_commands::save_network_proxy,
            application::network_proxy_commands::test_network_proxy,
            application::notification_commands::dismiss_task_notifications,
            enable_autostart,
            get_tray_icon_visible,
            set_tray_icon_visible,
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
            cancel_native_request,
            get_app_info,
            install_app_update,
            get_runtime_performance_metrics,
            record_frontend_diagnostic,
            export_diagnostics,
            save_conversation_export,
            get_temporary_workspace_settings,
            choose_temporary_workspace_root,
            get_task_activities,
            acknowledge_task_activity,
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
            application::personalization_commands::get_global_instructions,
            application::saved_prompts_commands::sync_saved_prompts,
            application::personalization_commands::save_global_instructions,
            list_projects,
            add_project,
            rename_project,
            remove_project,
            reorder_projects,
            list_project_directories,
            create_project_directory,
            list_completed_tasks,
            list_scheduled_tasks,
            read_acp_scheduled_config,
            set_acp_scheduled_config,
            preview_scheduled_task,
            create_scheduled_task,
            update_scheduled_task,
            delete_scheduled_task,
            set_scheduled_task_enabled,
            run_scheduled_task_now,
            list_tasks,
            search_tasks,
            search_task_occurrences,
            start_task,
            resolve_pending_request,
            list_project_files,
            search_project_files,
            stop_project_file_search,
            create_project_file,
            rename_project_file,
            delete_project_file,
            open_project_file_window,
            read_project_source_file,
            read_project_text_file,
            read_project_text_file_revision,
            save_project_text_file,
            get_project_git_status,
            get_project_git_history,
            get_project_git_commit_files,
            get_project_git_commit_file_diff,
            switch_project_branch,
            create_project_branch,
            list_project_worktrees,
            application::worktree_task_commands::create_task_worktree,
            application::worktree_task_commands::start_worktree_task,
            generate_commit_message,
            optimize_prompt,
            discard_project_changes,
            commit_project_changes,
            push_project_commits,
            upload_attachment,
            import_host_attachment,
            cache_project_image,
            get_project_pdf_file,
            list_host_files,
            get_project_open_capabilities,
            open_project,
            open_task_attachment,
            rename_task,
            pin_task,
        ])
        .build(context);

    let app = match result {
        Ok(app) => app,
        Err(error) => {
            eprintln!("failed to build Codexly: {error}");
            return;
        }
    };
    app.run(|app, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            application::notification_delivery::clear(app, None);
            diagnostics::mark_clean_shutdown(app);
        }
        handle_run_event(app, event);
    });
}
