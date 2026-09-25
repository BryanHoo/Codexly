use std::time::Duration;

use tauri::{AppHandle, Manager, WebviewWindow};
use tauri_nspanel::{
    CollectionBehavior, ManagerExt as _, PanelLevel, StyleMask, TrackingAreaOptions,
    WebviewWindowExt as _, tauri_panel,
};
use tokio::sync::oneshot;

use super::error::AppError;

const DRAG_RELEASE_POLL_INTERVAL: Duration = Duration::from_millis(8);

tauri_panel! {
    panel!(DesktopPetPanel {
        config: {
            can_become_main_window: false,
            can_become_key_window: macos_panel_activation::can_become_key_window(),
            becomes_key_only_if_needed: true,
            is_floating_panel: true
        }
        with: {
            tracking_area: {
                options: panel_tracking_options(),
                auto_resize: true
            }
        }
    })

    panel_event!(DesktopPetPanelEventHandler {})
}

fn panel_tracking_options() -> tauri_nspanel::objc2_app_kit::NSTrackingAreaOptions {
    TrackingAreaOptions::new()
        .active_always()
        .mouse_entered_and_exited()
        .value()
}

fn prevent_application_activation(panel: &dyn tauri_nspanel::Panel) {
    // tauri-nspanel 动态转换 NSWindow，需补齐原生非激活面板初始化时设置的 CPS 标记。
    macos_panel_activation::prevent_activation(panel.as_panel());
}

fn panel_collection_behavior() -> tauri_nspanel::objc2_app_kit::NSWindowCollectionBehavior {
    CollectionBehavior::new()
        .can_join_all_spaces()
        .full_screen_auxiliary()
        .value()
}

fn should_restore_main_window(application_is_active: bool, main_window_exists: bool) -> bool {
    application_is_active && main_window_exists
}

fn restore_main_window(app: &AppHandle) -> Result<(), AppError> {
    let main = app.get_webview_window("main");
    if should_restore_main_window(
        macos_panel_activation::application_is_active(),
        main.is_some(),
    ) && let Some(main) = main
    {
        // 主窗口成为 key window 时会由 AppKit 自动让宠物面板退出 key 状态，并保留原 first responder。
        main.set_focus()
            .map_err(|_| AppError::DesktopPetWindowFailed)?;
    }
    Ok(())
}

async fn wait_for_mouse_button_release<F>(mut is_pressed: F)
where
    F: FnMut() -> bool,
{
    while is_pressed() {
        tokio::time::sleep(DRAG_RELEASE_POLL_INTERVAL).await;
    }
}

async fn dispatch_to_main_thread<T, F>(app: &AppHandle, operation: F) -> Result<T, AppError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, AppError> + Send + 'static,
{
    let (sender, receiver) = oneshot::channel();
    // tauri-nspanel 直接调用 AppKit；所有面板生命周期操作必须在 macOS 主线程执行。
    app.run_on_main_thread(move || {
        let _ = sender.send(operation());
    })
    .map_err(|_| AppError::DesktopPetWindowFailed)?;
    receiver
        .await
        .map_err(|_| AppError::DesktopPetWindowFailed)?
}

pub(super) async fn configure_desktop_overlay(window: &WebviewWindow) -> Result<(), AppError> {
    let app = window.app_handle().clone();
    let panel_app = app.clone();
    let window = window.clone();
    dispatch_to_main_thread(&app, move || {
        let panel = window
            .to_panel::<DesktopPetPanel>()
            .map_err(|_| AppError::DesktopPetWindowFailed)?;
        panel.set_level(PanelLevel::Floating.value());
        panel.set_style_mask(StyleMask::empty().nonactivating_panel().into());
        prevent_application_activation(panel.as_ref());
        panel.set_collection_behavior(panel_collection_behavior());
        let handler = DesktopPetPanelEventHandler::new();
        handler.on_mouse_exited(move |_| {
            // 离开宠物区域时恢复应用内原 key 路径；外部应用在前台时保持不激活。
            let _ = restore_main_window(&panel_app);
        });
        panel.set_event_handler(Some(handler.as_ref()));
        Ok(())
    })
    .await
}

pub(super) async fn run_desktop_pet_drag(window: &WebviewWindow) -> Result<(), AppError> {
    let app = window.app_handle().clone();
    let window = window.clone();
    let drag_started = dispatch_to_main_thread(&app, move || {
        if !macos_panel_activation::primary_mouse_button_pressed() {
            return Ok(false);
        }
        // Tauri 仅将原生拖拽排入事件循环；物理释放状态由下方异步等待负责。
        window
            .start_dragging()
            .map_err(|_| AppError::DesktopPetWindowFailed)
            .map(|()| true)
    })
    .await?;
    if drag_started {
        wait_for_mouse_button_release(macos_panel_activation::primary_mouse_button_pressed).await;
    }
    let focus_app = app.clone();
    dispatch_to_main_thread(&app, move || restore_main_window(&focus_app)).await
}

pub(super) async fn destroy_desktop_overlay(app: &AppHandle, label: &str) -> Result<(), AppError> {
    let main_app = app.clone();
    let label = label.to_string();
    dispatch_to_main_thread(app, move || {
        if let Ok(panel) = main_app.get_webview_panel(&label) {
            // 先恢复原始 NSWindow class，再销毁窗口，避免残留的面板句柄跨线程释放。
            let window = panel.to_window().ok_or(AppError::DesktopPetWindowFailed)?;
            window
                .destroy()
                .map_err(|_| AppError::DesktopPetWindowFailed)?;
        } else if let Some(window) = main_app.get_webview_window(&label) {
            window
                .destroy()
                .map_err(|_| AppError::DesktopPetWindowFailed)?;
        }
        Ok(())
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn panel_joins_fullscreen_spaces() {
        let behavior = panel_collection_behavior();
        assert!(
            behavior.contains(
                tauri_nspanel::objc2_app_kit::NSWindowCollectionBehavior::CanJoinAllSpaces
            )
        );
        assert!(behavior.contains(
            tauri_nspanel::objc2_app_kit::NSWindowCollectionBehavior::FullScreenAuxiliary
        ));
    }

    #[test]
    fn panel_tracks_mouse_exit_while_application_is_inactive() {
        let options = panel_tracking_options();
        assert!(
            options.contains(tauri_nspanel::objc2_app_kit::NSTrackingAreaOptions::ActiveAlways)
        );
        assert!(
            options.contains(
                tauri_nspanel::objc2_app_kit::NSTrackingAreaOptions::MouseEnteredAndExited
            )
        );
    }

    #[test]
    fn main_window_focus_is_only_restored_inside_the_active_application() {
        assert!(!should_restore_main_window(false, true));
        assert!(!should_restore_main_window(true, false));
        assert!(should_restore_main_window(true, true));
    }

    #[tokio::test]
    async fn native_drag_waits_until_the_primary_button_is_released() {
        let mut checks = 0;
        wait_for_mouse_button_release(|| {
            checks += 1;
            checks < 3
        })
        .await;

        assert_eq!(checks, 3);
    }
}
