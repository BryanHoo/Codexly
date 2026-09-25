use super::state::AppState;
use crate::domain::project_terminal::TerminalError;
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
};
use tauri::{AppHandle, Manager, WebviewWindow, WindowEvent};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

#[derive(Default)]
pub(crate) struct TerminalLifecycle {
    owner: Mutex<Option<Arc<WindowOwner>>>,
    exiting: AtomicBool,
}

#[derive(Default)]
struct WindowOwner {
    generation: Mutex<String>,
}

impl TerminalLifecycle {
    fn owner(&self) -> Option<Arc<WindowOwner>> {
        self.owner
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
    }
    pub fn is_closing(&self) -> bool {
        self.exiting.load(Ordering::Acquire)
    }
    pub fn bind_generation(&self, generation: &str) {
        if let Some(owner) = self.owner() {
            *owner
                .generation
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner) = generation.to_owned();
        }
    }
}

pub(crate) fn bind_window(app: &AppHandle, window: &WebviewWindow) {
    let manager = app.state::<AppState>().terminals.clone();
    let owner = Arc::new(WindowOwner {
        generation: Mutex::new(manager.generation()),
    });
    *app.state::<TerminalLifecycle>()
        .owner
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(owner.clone());
    // 每个原生窗口捕获独立 owner；重建窗口后，旧 Destroyed 回调不会读取新窗口的 generation。
    window.on_window_event(move |event| {
        if matches!(event, WindowEvent::Destroyed) {
            let generation = owner
                .generation
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .clone();
            let manager = manager.clone();
            tauri::async_runtime::spawn_blocking(move || {
                if let Err(error) = manager.close_generation(&generation) {
                    crate::infrastructure::diagnostics::record_error(
                        "terminal_owner_cleanup_failed",
                        error,
                    );
                }
            });
        }
    });
}

pub(crate) fn resume_owner(app: &AppHandle) {
    let manager = &app.state::<AppState>().terminals;
    if !app.state::<TerminalLifecycle>().is_closing() && manager.live_count() == 0 {
        manager.set_closing(false);
    }
}

pub(crate) fn request_exit(app: &AppHandle, code: i32) -> bool {
    let manager = app.state::<AppState>().terminals.clone();
    if manager.live_count() == 0 {
        return false;
    }
    if app
        .state::<TerminalLifecycle>()
        .exiting
        .swap(true, Ordering::AcqRel)
    {
        return true;
    }
    manager.set_closing(true);
    let generation = manager.generation();
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let result =
            tauri::async_runtime::spawn_blocking(move || manager.close_generation(&generation))
                .await;
        if matches!(result, Ok(Ok(()))) {
            app.exit(code);
        } else {
            app.state::<TerminalLifecycle>()
                .exiting
                .store(false, Ordering::Release);
            report_cleanup_failure(&app);
        }
    });
    true
}

fn report_cleanup_failure(app: &AppHandle) {
    super::app_close::reset_close_confirmation(app);
    crate::infrastructure::diagnostics::record_error(
        "terminal_cleanup_failed",
        TerminalError::CleanupFailed,
    );
    app.dialog()
        .message("本地终端未能完成清理，窗口和应用将保持打开。请重试关闭。")
        .title("终端清理失败")
        .kind(MessageDialogKind::Error)
        .show(|_| {});
}
