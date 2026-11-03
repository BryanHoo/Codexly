use super::error::AppError;
use serde_json::Value;
use tauri::AppHandle;

/// 常用提示词属于应用本地数据，不启动 Codex 或 Claude 进程。
#[tauri::command]
pub async fn sync_saved_prompts(app: AppHandle, input: Value) -> Result<Value, AppError> {
    Ok(super::sidebar_commands::local_catalog(&app)?
        .call("prompts.sync", input)
        .await?)
}
