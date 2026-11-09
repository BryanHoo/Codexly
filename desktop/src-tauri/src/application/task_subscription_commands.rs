use tauri::{AppHandle, Manager, State};

use super::{error::AppError, state::AppState, task_subscription::unsubscribe_retry_delay};
use crate::infrastructure::codex;

#[tauri::command(rename_all = "camelCase")]
pub async fn retain_task_subscription(
    app: AppHandle,
    project_id: String,
    task_id: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    if project_id.is_empty() || project_id.len() > 128 || task_id.is_empty() || task_id.len() > 128
    {
        return Err(AppError::CodexRequestFailed);
    }
    crate::infrastructure::diagnostics::record(
        crate::infrastructure::diagnostics::DiagnosticLevel::Info,
        "task_subscription_retain_started",
        None,
        std::collections::BTreeMap::from([
            ("projectId".into(), serde_json::json!(project_id)),
            ("taskId".into(), serde_json::json!(task_id)),
        ]),
    );
    let task = super::claude_tasks::task(&app, &project_id, &task_id).await?;
    state.retain_task_subscription(&task_id).await;
    if task["provider"] == "claude" {
        return Ok(());
    }
    let connection = state.codex_connection().await?;
    // 挂载时只恢复线程元数据以确认写入权；历史仍走分页，冲突交给前端只读展示。
    let result = codex::retain_task_writer(&connection, &project_id, &task_id).await;
    crate::infrastructure::diagnostics::record(
        if result.is_ok() {
            crate::infrastructure::diagnostics::DiagnosticLevel::Info
        } else {
            crate::infrastructure::diagnostics::DiagnosticLevel::Error
        },
        "task_subscription_retain_completed",
        result.as_ref().err().map(ToString::to_string),
        std::collections::BTreeMap::from([
            ("projectId".into(), serde_json::json!(project_id)),
            ("taskId".into(), serde_json::json!(task_id)),
            ("success".into(), serde_json::json!(result.is_ok())),
        ]),
    );
    result.map_err(AppError::from)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn release_task_subscription(
    app: AppHandle,
    project_id: String,
    task_id: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    if project_id.is_empty() || project_id.len() > 128 || task_id.is_empty() || task_id.len() > 128
    {
        return Err(AppError::CodexRequestFailed);
    }
    let generation = state.release_task_subscription(&task_id).await;
    spawn_task_subscription_release(app, project_id, task_id, generation);
    Ok(())
}

pub(super) fn spawn_task_subscription_release(
    app: AppHandle,
    project_id: String,
    task_id: String,
    generation: u64,
) {
    tauri::async_runtime::spawn(run_task_subscription_release(
        app, project_id, task_id, generation,
    ));
}

async fn run_task_subscription_release(
    app: AppHandle,
    project_id: String,
    task_id: String,
    generation: u64,
) {
    if super::claude_tasks::task(&app, &project_id, &task_id)
        .await
        .is_ok_and(|task| task["provider"] == "claude")
    {
        app.state::<AppState>()
            .complete_task_subscription_release(&task_id, generation)
            .await;
        return;
    }
    let mut attempt = 0;
    loop {
        let state = app.state::<AppState>();
        if !state
            .is_task_subscription_release_current(&task_id, generation)
            .await
        {
            return;
        }
        let result = match state.codex_connection().await {
            Ok(connection) => codex::unsubscribe_task(&connection, &project_id, &task_id).await,
            Err(_) => {
                tokio::time::sleep(unsubscribe_retry_delay(attempt)).await;
                attempt = attempt.saturating_add(1);
                continue;
            }
        };
        match result {
            Ok(response) if response.status != "busy" => {
                state
                    .complete_task_subscription_release(&task_id, generation)
                    .await;
                return;
            }
            Ok(_) | Err(_) => {
                tokio::time::sleep(unsubscribe_retry_delay(attempt)).await;
                attempt = attempt.saturating_add(1);
            }
        }
    }
}
