use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;
use tokio::sync::oneshot;

use super::error::AppError;
use crate::infrastructure::temporary_workspace_settings::{self, TemporaryWorkspaceSettings};

#[tauri::command]
pub async fn get_temporary_workspace_settings(
    app: AppHandle,
) -> Result<TemporaryWorkspaceSettings, AppError> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    let root_path = temporary_workspace_settings::read_root(&app_data)
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    Ok(TemporaryWorkspaceSettings { root_path })
}

#[tauri::command]
pub async fn choose_temporary_workspace_root(
    app: AppHandle,
) -> Result<Option<TemporaryWorkspaceSettings>, AppError> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    let root = temporary_workspace_settings::read_root(&app_data)
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    let (sender, receiver) = oneshot::channel();
    let mut dialog = app.dialog().file();
    if tokio::fs::metadata(&root)
        .await
        .is_ok_and(|metadata| metadata.is_dir())
    {
        dialog = dialog.set_directory(&root);
    }
    if let Some(window) = app.get_webview_window("main") {
        dialog = dialog.set_parent(&window);
    }
    // 使用异步原生目录选择器，取消时不修改配置，也不阻塞 WebView 或运行时线程。
    dialog.pick_folder(move |path| {
        let _ = sender.send(path);
    });
    let Some(selected) = receiver
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)?
    else {
        return Ok(None);
    };
    let selected = selected
        .into_path()
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    let root_path = temporary_workspace_settings::save_root(&app_data, &selected)
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    Ok(root_path.map(|root_path| TemporaryWorkspaceSettings { root_path }))
}
