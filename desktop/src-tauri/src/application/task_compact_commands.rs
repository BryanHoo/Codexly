use super::{error::AppError, state::AppState};
use crate::infrastructure::codex;
use serde_json::{Value, json};
use tauri::{AppHandle, State};

#[tauri::command(rename_all = "camelCase")]
pub async fn compact_task(
    app: AppHandle,
    project_id: String,
    task_id: String,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let task = super::claude_tasks::task(&app, &project_id, &task_id).await?;
    if task["provider"] == "claude" {
        // 显式传入此聊天保存的设置，不让新会话默认权限覆盖历史会话。
        let settings =
            super::sidebar_task_settings::effective_task_settings(&app, &project_id, &task_id)
                .await?;
        state.remember_tasks(&project_id, [task_id.as_str()]).await;
        return state
            .claude
            .request(
                &app,
                "task.compact",
                Some(super::claude_tasks::scope(&task)),
                json!({"taskId":task_id,"options":settings}),
            )
            .await;
    }
    let connection = state.codex_connection().await?;
    let response = codex::compact_task(&connection, &project_id, &task_id)
        .await
        .map_err(AppError::from)?;
    serde_json::to_value(response).map_err(|_| AppError::CodexRequestFailed)
}
