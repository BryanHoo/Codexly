use super::{
    error::AppError,
    prompt_submission::SubmissionBudget,
    state::AppState,
    turn_start::{TurnStartRegistry, fingerprint_steer},
};
use crate::domain::conversation::AgentPromptInput;
use serde_json::Value;
use std::future::Future;
use tauri::{AppHandle, Manager};

#[tauri::command(rename_all = "camelCase")]
pub async fn steer_turn(
    app: AppHandle,
    project_id: String,
    task_id: String,
    turn_id: String,
    input: AgentPromptInput,
    idempotency_key: String,
    queued_submission_id: Option<String>,
) -> Result<Value, Value> {
    let state = app.state::<AppState>();
    let worker_app = app.clone();
    let worker_project = project_id.clone();
    let worker_task = task_id.clone();
    let worker_turn = turn_id.clone();
    let execute = move |mut input| async move {
        let app_data = worker_app
            .path()
            .app_data_dir()
            .map_err(|_| AppError::FilesystemRequestFailed)?;
        // 只在登记后的首次执行中解析附件；重复请求不再次访问文件或发送指令。
        super::attachment_commands::resolve_prompt_attachments(
            &app_data,
            &worker_project,
            &worker_task,
            &mut input,
        )
        .await?;
        let state = worker_app.state::<AppState>();
        let connection = state.codex_connection().await?;
        let response =
            crate::infrastructure::codex::steer_turn(&connection, worker_task, worker_turn, input)
                .await
                .map_err(AppError::from)?;
        serde_json::to_value(response).map_err(|_| AppError::CodexRequestFailed)
    };
    if let Some(queued_submission_id) = queued_submission_id {
        let cleanup_app = app.clone();
        let cleanup_project = project_id.clone();
        let cleanup_task = task_id.clone();
        let cleanup_id = queued_submission_id.clone();
        super::queued_steer::run(
            state.queued_steers.clone(),
            &state.submission_budget,
            super::queued_steer::QueuedSteerRequest {
                project_id,
                task_id,
                turn_id,
                input,
                idempotency_key,
                queued_submission_id,
            },
            execute,
            move || async move {
                super::workflow_commands::delete_queued_submission(
                    cleanup_project,
                    cleanup_task,
                    cleanup_id,
                    cleanup_app.state::<AppState>(),
                )
                .await
                .map(|_| ())
            },
        )
        .await
    } else {
        run(
            &state.steer_submissions,
            &state.submission_budget,
            SteerRequest {
                project_id,
                task_id,
                turn_id,
                input,
                idempotency_key,
            },
            execute,
        )
        .await
    }
}

struct SteerRequest {
    project_id: String,
    task_id: String,
    turn_id: String,
    input: AgentPromptInput,
    idempotency_key: String,
}

async fn run<E, F>(
    registry: &TurnStartRegistry,
    budget: &SubmissionBudget,
    request: SteerRequest,
    execute: E,
) -> Result<Value, Value>
where
    E: FnOnce(AgentPromptInput) -> F,
    F: Future<Output = Result<Value, AppError>> + Send + 'static,
{
    let identity = fingerprint_steer(
        &request.project_id,
        &request.task_id,
        &request.turn_id,
        &request.input,
    )?;
    // 与普通提交、Review 共用入口预算，重复等待者也不能无限持有输入。
    let _admission = budget.reserve(identity.encoded_bytes())?;
    registry
        .run(&request.idempotency_key, identity, execute(request.input))
        .await
}

#[cfg(test)]
#[path = "steer_submission_tests.rs"]
mod tests;
