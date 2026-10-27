use tauri::{AppHandle, Manager, State};
use tokio::sync::Mutex;

use super::{error::AppError, tray_commands::set_tray_visible};
use crate::infrastructure::{app_data, diagnostics, tray_settings};

pub(crate) struct TrayVisibility(Mutex<bool>);

pub(crate) fn initialize_tray_visibility(app: &AppHandle) -> tauri::Result<()> {
    let directory = app_data::directory(app)?;
    let mut visible = tauri::async_runtime::block_on(tray_settings::read_visible(&directory))
        .unwrap_or_else(|error| {
            // 偏好不可读不能阻断桌面启动；记录诊断，并保持默认显示。
            diagnostics::record_error("tray_settings_read_failed", error);
            true
        });
    if !visible && let Err(error) = set_tray_visible(app, false) {
        // 平台不支持隐藏时继续使用可见托盘，不改变关闭窗口的行为。
        diagnostics::record_error("tray_visibility_restore_failed", error);
        visible = true;
    }
    app.manage(TrayVisibility(Mutex::new(visible)));
    Ok(())
}

#[tauri::command]
pub(crate) async fn get_tray_icon_visible(
    state: State<'_, TrayVisibility>,
) -> Result<bool, AppError> {
    Ok(*state.inner().0.lock().await)
}

#[tauri::command]
pub(crate) async fn set_tray_icon_visible(
    app: AppHandle,
    state: State<'_, TrayVisibility>,
    visible: bool,
) -> Result<bool, AppError> {
    // 串行覆盖原生操作与落盘，避免快速切换造成界面、内存和配置顺序不一致。
    let mut current = state.inner().0.lock().await;
    if *current == visible {
        return Ok(visible);
    }
    let directory = app_data::directory(&app).map_err(|_| AppError::FilesystemRequestFailed)?;
    set_tray_visible(&app, visible)?;
    if let Err(error) = tray_settings::write_visible(&directory, visible).await {
        // 保存失败恢复原生显示，不向界面报告一个无法在重启后保留的成功状态。
        if let Err(rollback) = set_tray_visible(&app, *current) {
            diagnostics::record_error("tray_visibility_rollback_failed", rollback);
        }
        diagnostics::record_error("tray_settings_write_failed", error);
        return Err(AppError::FilesystemRequestFailed);
    }
    *current = visible;
    Ok(visible)
}
