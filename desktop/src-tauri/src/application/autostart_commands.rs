use tauri::AppHandle;
use tauri_plugin_autostart::ManagerExt;

use super::error::AppError;

#[tauri::command]
pub async fn enable_autostart(app: AppHandle) -> Result<(), AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(target_os = "windows")]
        let (key, command) = {
            use winreg::enums::{HKEY_CURRENT_USER, KEY_SET_VALUE};
            let executable = std::env::current_exe().map_err(|_| AppError::AutostartFailed)?;
            let key = winreg::RegKey::predef(HKEY_CURRENT_USER)
                .open_subkey_with_flags(
                    "Software\\Microsoft\\Windows\\CurrentVersion\\Run",
                    KEY_SET_VALUE,
                )
                .map_err(|_| AppError::AutostartFailed)?;
            (key, format!("\"{}\"", executable.display()))
        };
        app.autolaunch()
            .enable()
            .map_err(|_| AppError::AutostartFailed)?;
        // The plugin writes an unquoted Windows path; login must preserve spaces.
        #[cfg(target_os = "windows")]
        key.set_value(&app.package_info().name, &command)
            .map_err(|_| AppError::AutostartFailed)?;
        Ok(())
    })
    .await
    .map_err(|_| AppError::AutostartFailed)?
}
