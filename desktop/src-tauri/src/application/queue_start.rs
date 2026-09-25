use super::{
    error::AppError,
    prompt_submission::SubmissionBudget,
    state::AppState,
    turn_start::{TurnStartRegistry, fingerprint_queue_start},
};
use serde_json::Value;
use std::{future::Future, sync::Arc};
use tauri::{AppHandle, Manager};

#[tauri::command(rename_all = "camelCase")]
pub async fn start_queued_submission(
    app: AppHandle,
    project_id: String,
    task_id: String,
    queued_submission_id: Option<String>,
    idempotency_key: String,
) -> Result<Value, Value> {
    let state = app.state::<AppState>();
    let worker_app = app.clone();
    let worker_project = project_id.clone();
    let worker_task = task_id.clone();
    let worker_submission = queued_submission_id.clone();
    let cleanup_app = app.clone();
    let cleanup_project = project_id.clone();
    let cleanup_task = task_id.clone();
    run(
        &state.queue_starts,
        &state.submission_budget,
        QueueStartRequest {
            project_id,
            task_id,
            queued_submission_id,
            idempotency_key,
        },
        async move {
            let state = worker_app.state::<AppState>();
            let connection = state.codex_connection().await?;
            crate::infrastructure::codex::read_task(
                &connection,
                worker_project.clone(),
                worker_task.clone(),
            )
            .await
            .map_err(AppError::from)?;
            let (selected, _consumption_lease) = match super::queue_start_recovery::select(
                &state.queued_steers, &connection, &worker_project, &worker_task, worker_submission,
            ).await? {
                super::queue_start_recovery::Selection::Start(id, lease) => (id, lease),
                super::queue_start_recovery::Selection::Cleanup(id) => {
                    return Ok(serde_json::json!({"cleanupOnly":true, "taskId":worker_task, "queuedSubmissionId":id}));
                }
            };
            let response = crate::infrastructure::codex::start_queued_submission(
                &connection,
                &worker_task,
                Some(&selected),
            )
            .await
            .map_err(AppError::from)?;
            serde_json::to_value(response).map_err(|_| AppError::CodexRequestFailed)
        },
        move |id| async move {
            let state = cleanup_app.state::<AppState>();
            let connection = state.codex_connection().await.map_err(|error| serde_json::json!(error))?;
            crate::infrastructure::codex::read_task(&connection, cleanup_project.clone(), cleanup_task.clone())
                .await.map_err(|error| serde_json::json!(AppError::from(error)))?;
            super::queue_start_recovery::cleanup(&state.queued_steers, &connection, &cleanup_project, &cleanup_task, &id).await?;
            Ok(())
        },
    )
    .await
}

struct QueueStartRequest {
    project_id: String,
    task_id: String,
    queued_submission_id: Option<String>,
    idempotency_key: String,
}

async fn run<F, C, D>(
    registry: &Arc<TurnStartRegistry>,
    budget: &SubmissionBudget,
    request: QueueStartRequest,
    execute: F,
    cleanup: C,
) -> Result<Value, Value>
where
    F: Future<Output = Result<Value, AppError>> + Send + 'static,
    C: FnOnce(String) -> D + Send + 'static,
    D: Future<Output = Result<(), Value>> + Send + 'static,
{
    let identity = fingerprint_queue_start(
        &request.project_id,
        &request.task_id,
        request.queued_submission_id.as_deref(),
    )?;
    let admission = budget.reserve(identity.encoded_bytes())?;
    let registry = Arc::clone(registry);
    // 入口预算覆盖决策与清理；取消等待不能截断已登记的恢复操作。
    tokio::spawn(async move {
        let _admission = admission;
        let response = registry.run(&request.idempotency_key, identity, execute).await?;
        if response.get("cleanupOnly") == Some(&Value::Bool(true)) {
            let id = response.get("queuedSubmissionId").and_then(Value::as_str)
                .ok_or_else(|| serde_json::json!({"code":"TURN_START_UNCERTAIN", "message":"Queue cleanup identity is unavailable"}))?;
            // 只缓存选中的清理身份，失败重试不能重新选择下一项。
            cleanup(id.to_owned()).await?;
        }
        Ok(response)
    }).await.map_err(|_| serde_json::json!({"code":"TURN_START_UNCERTAIN", "message":"Queue start result is unavailable"}))?
}

#[cfg(test)]
#[path = "queue_start_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "queue_start_cleanup_tests.rs"]
mod cleanup_tests;
