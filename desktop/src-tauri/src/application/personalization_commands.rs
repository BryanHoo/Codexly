use super::error::AppError;
use crate::{domain::personalization::GlobalInstructions, infrastructure::personalization};
use tauri::{AppHandle, Manager};

#[tauri::command]
pub async fn get_global_instructions(app: AppHandle) -> Result<GlobalInstructions, AppError> {
    personalization::read_instructions(&codex_home(&app)?)
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn save_global_instructions(
    content: String,
    expected_content: String,
    app: AppHandle,
) -> Result<GlobalInstructions, AppError> {
    personalization::save_instructions(&codex_home(&app)?, &content, &expected_content)
        .await
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::AlreadyExists {
                AppError::GlobalInstructionsChanged
            } else {
                AppError::FilesystemRequestFailed
            }
        })
}

pub(super) fn codex_home(app: &AppHandle) -> Result<std::path::PathBuf, AppError> {
    if let Some(path) = std::env::var_os("CODEX_HOME") {
        return Ok(path.into());
    }
    Ok(app
        .path()
        .home_dir()
        .map_err(|_| AppError::FilesystemRequestFailed)?
        .join(".codex"))
}
