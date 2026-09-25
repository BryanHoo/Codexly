use std::sync::{
    Mutex,
    atomic::{AtomicBool, Ordering},
};

#[cfg(target_os = "macos")]
use tauri::menu::{MenuItem, MenuItemKind};
use tauri::{
    AppHandle, Emitter as _, Manager as _, RunEvent, Url, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, Window, WindowEvent,
};

use super::desktop_pet_commands::acknowledge_completed_desktop_pet_route;

const MAIN_WINDOW_LABEL: &str = "main";
const MAIN_WINDOW_NAVIGATE_EVENT: &str = "main-window://navigate";
#[cfg(target_os = "macos")]
const QUIT_APP_MENU_ID: &str = "quit-app";

#[derive(Default)]
pub(crate) struct MainWindowLifecycle {
    inner: Mutex<MainWindowLifecycleState>,
    pub(super) close_confirmation: super::app_close::CloseConfirmation,
    storage_exit_pending: AtomicBool,
    storage_exit_ready: AtomicBool,
}

#[derive(Default)]
struct MainWindowLifecycleState {
    restore_generation: u64,
    route: Option<String>,
}

impl MainWindowLifecycle {
    fn prepare_show(&self, route: Option<String>) -> u64 {
        let mut state = self.lock();
        state.restore_generation = state.restore_generation.wrapping_add(1);
        if route.is_some() {
            state.route = route;
        }
        state.restore_generation
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, MainWindowLifecycleState> {
        self.inner
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum CloseRequestAction {
    ConfirmClose,
    AllowClose,
}

fn close_request_action(window_label: &str) -> CloseRequestAction {
    if window_label == MAIN_WINDOW_LABEL {
        CloseRequestAction::ConfirmClose
    } else {
        CloseRequestAction::AllowClose
    }
}

#[cfg(target_os = "macos")]
pub(crate) fn configure_macos_quit_menu(app: &AppHandle) -> tauri::Result<()> {
    let Some(menu) = app.menu() else {
        return Ok(());
    };
    let Some(MenuItemKind::Submenu(application_menu)) = menu.items()?.into_iter().next() else {
        return Ok(());
    };
    let application_items = application_menu.items()?;
    if application_items.is_empty() {
        return Ok(());
    }

    // 替换直接 terminate: 的系统菜单项，让 Cmd+Q 与托盘共用关闭确认。
    application_menu.remove_at(application_items.len() - 1)?;
    let quit = MenuItem::with_id(
        app,
        QUIT_APP_MENU_ID,
        "退出 Codexly",
        true,
        Some("CmdOrCtrl+Q"),
    )?;
    application_menu.append(&quit)
}

pub(crate) fn handle_window_event(window: &Window, event: &WindowEvent) {
    if close_request_action(window.label()) != CloseRequestAction::ConfirmClose {
        return;
    }
    let WindowEvent::CloseRequested { api, .. } = event else {
        return;
    };

    api.prevent_close();
    super::app_close::request_close_confirmation(window.app_handle());
}

pub(crate) fn handle_run_event(app: &AppHandle, event: RunEvent) {
    let RunEvent::ExitRequested { code, api, .. } = event else {
        return;
    };
    // 辅助窗口销毁不代表用户确认退出，后台运行时和托盘必须继续存活。
    if should_keep_background_runtime_alive(code) {
        api.prevent_exit();
        // Dock 等系统退出入口没有退出码；主窗口仍存在时也必须先让用户选择。
        if app.get_webview_window(MAIN_WINDOW_LABEL).is_some() {
            super::app_close::request_close_confirmation(app);
        }
    } else if let Some(code) = code {
        let lifecycle = app.state::<MainWindowLifecycle>();
        if lifecycle.storage_exit_ready.load(Ordering::Acquire) {
            return;
        }
        api.prevent_exit();
        // 先完成终端清理；失败时保持存储可写，成功后再次请求退出进入落盘屏障。
        if super::terminal_lifecycle::request_exit(app, code)
            || lifecycle.storage_exit_pending.swap(true, Ordering::AcqRel)
        {
            return;
        }
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            match app
                .state::<super::app_storage_runtime::AppStorageRuntime>()
                .shutdown()
                .await
            {
                Ok(()) => {
                    app.state::<MainWindowLifecycle>()
                        .storage_exit_ready
                        .store(true, Ordering::Release);
                    app.exit(code);
                }
                Err(error) => {
                    crate::infrastructure::diagnostics::record_error(
                        "app_storage_shutdown_failed",
                        error,
                    );
                    super::app_close::reset_close_confirmation(&app);
                    // writer 异常退出时保持应用存活，不能把未完成的落盘当作成功。
                    app.state::<MainWindowLifecycle>()
                        .storage_exit_pending
                        .store(false, Ordering::Release);
                }
            }
        });
    }
}

fn should_keep_background_runtime_alive(exit_code: Option<i32>) -> bool {
    exit_code.is_none()
}

pub(super) fn show_main_window(app: &AppHandle) {
    queue_main_window_restore(app, None);
}

pub(crate) fn show_main_window_at_route(app: &AppHandle, route: String) {
    queue_main_window_restore(app, Some(route));
}

pub(super) fn restore_main_window_at_route(app: &AppHandle, route: String) -> tauri::Result<()> {
    let generation = app
        .state::<MainWindowLifecycle>()
        .prepare_show(Some(route.clone()));
    restore_main_window(app, generation, Some(route))
}

pub(super) fn visible_main_window_route(app: &AppHandle) -> Option<String> {
    let window = app.get_webview_window(MAIN_WINDOW_LABEL)?;
    // 隐藏或最小化窗口不算用户正在查看，后台完成仍应保留待查看气泡。
    if !window.is_visible().ok()? || window.is_minimized().ok()? {
        return None;
    }
    window.url().ok().map(|url| app_route_from_url(&url))
}

fn queue_main_window_restore(app: &AppHandle, route: Option<String>) {
    let generation = app
        .state::<MainWindowLifecycle>()
        .prepare_show(route.clone());
    let app = app.clone();
    // Windows WebView2 不能在同步托盘回调中创建窗口，统一切到异步运行时重建。
    tauri::async_runtime::spawn(async move {
        if let Err(error) = restore_main_window(&app, generation, route) {
            crate::infrastructure::diagnostics::record_error("main_window_restore_failed", error);
        }
    });
}

fn restore_main_window(
    app: &AppHandle,
    generation: u64,
    requested_route: Option<String>,
) -> tauri::Result<()> {
    #[cfg(target_os = "macos")]
    let _ = app.set_dock_visibility(true);
    let lifecycle = app.state::<MainWindowLifecycle>();
    let saved_route = {
        let state = lifecycle.lock();
        if state.restore_generation != generation {
            return Err(tauri::Error::WindowNotFound);
        }
        state.route.clone()
    };
    let (window, should_navigate) = match app.get_webview_window(MAIN_WINDOW_LABEL) {
        Some(window) => (window, true),
        None => (create_main_window(app, saved_route)?, false),
    };

    if should_navigate && let Some(route) = requested_route.as_deref() {
        window.emit(MAIN_WINDOW_NAVIGATE_EVENT, route)?;
    }

    window.unminimize()?;
    window.show()?;
    window.set_focus()?;
    super::terminal_lifecycle::resume_owner(app);

    let active_route =
        requested_route.or_else(|| window.url().ok().map(|url| app_route_from_url(&url)));
    if let Some(route) = active_route {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            acknowledge_completed_desktop_pet_route(&app, &route).await;
        });
    }
    Ok(())
}

fn create_main_window(app: &AppHandle, route: Option<String>) -> tauri::Result<WebviewWindow> {
    let mut config = app
        .config()
        .app
        .windows
        .iter()
        .find(|config| config.label == MAIN_WINDOW_LABEL)
        .cloned()
        .ok_or_else(|| tauri::Error::WindowNotFound)?;
    if let Some(route) = route {
        config.url = WebviewUrl::App(route.into());
    }
    let window = WebviewWindowBuilder::from_config(app, &config)?.build()?;
    super::terminal_lifecycle::bind_window(app, &window);
    Ok(window)
}

fn app_route_from_url(url: &Url) -> String {
    let mut route = url.path().trim_start_matches('/').to_owned();
    if route.is_empty() {
        route.push_str("index.html");
    }
    if let Some(query) = url.query() {
        route.push('?');
        route.push_str(query);
    }
    if let Some(fragment) = url.fragment() {
        route.push('#');
        route.push_str(fragment);
    }
    route
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn main_window_close_requires_confirmation() {
        assert_eq!(
            close_request_action("main"),
            CloseRequestAction::ConfirmClose
        );
    }

    #[test]
    fn background_runtime_only_survives_implicit_exit_requests() {
        assert!(should_keep_background_runtime_alive(None));
        assert!(!should_keep_background_runtime_alive(Some(0)));
    }

    #[test]
    fn desktop_pet_window_keeps_its_native_close_behavior() {
        assert_eq!(
            close_request_action("desktop-pet"),
            CloseRequestAction::AllowClose
        );
    }

    #[test]
    fn latest_requested_route_replaces_the_saved_route() {
        let lifecycle = MainWindowLifecycle::default();
        lifecycle.prepare_show(Some("p/project-a".to_owned()));
        let generation = lifecycle.prepare_show(Some("p/project-a/t/task-a".to_owned()));
        let state = lifecycle.lock();

        assert_eq!(state.restore_generation, generation);
        assert_eq!(state.route.as_deref(), Some("p/project-a/t/task-a"));
    }

    #[test]
    fn restored_app_route_preserves_path_query_and_fragment() {
        let route = app_route_from_url(
            &Url::parse("tauri://localhost/p/project-a/task/task-a?panel=context#turn-a").unwrap(),
        );

        assert_eq!(route, "p/project-a/task/task-a?panel=context#turn-a");
        assert_eq!(
            app_route_from_url(&Url::parse("tauri://localhost/").unwrap()),
            "index.html"
        );
    }
}
