use tauri::{AppHandle, Manager};

use super::error::AppError;
use crate::{
    domain::conversation::AgentTaskSettings,
    infrastructure::{codex, task_settings::read_task_settings},
};

pub(super) async fn effective_task_settings(
    app: &AppHandle,
    project_id: &str,
    task_id: &str,
) -> Result<AgentTaskSettings, AppError> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    if let Some(settings) = read_task_settings(&app_data, project_id, task_id)
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)?
    {
        return Ok(settings);
    }

    // 未配置 Task 专属设置时回退项目默认值，并在进入运行时前验证完整性。
    let connection = app
        .state::<super::state::AppState>()
        .codex_connection()
        .await?;
    let settings = codex::read_project_defaults(&connection, &app_data, project_id)
        .await
        .map_err(AppError::from)?;
    let settings: AgentTaskSettings =
        serde_json::from_value(settings).map_err(|_| AppError::FilesystemRequestFailed)?;
    if settings.is_valid() {
        Ok(settings)
    } else {
        Err(AppError::CodexRequestFailed)
    }
}
