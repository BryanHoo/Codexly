use super::{
    error::AppError,
    prompt_submission::SubmissionBudget,
    state::AppState,
    turn_start::{TurnStartRegistry, fingerprint_queue_content},
};
use crate::{domain::conversation::AgentPromptInput, infrastructure::codex};
use serde_json::{Value, json};
use std::future::Future;
use tauri::{AppHandle, Manager};

pub(super) struct QueueAddRequest {
    pub project_id: String,
    pub task_id: String,
    pub input: AgentPromptInput,
    pub client_user_message_id: String,
    pub idempotency_key: String,
}

pub(super) async fn add(app: AppHandle, request: QueueAddRequest) -> Result<Value, Value> {
    let state = app.state::<AppState>();
    let worker_app = app.clone();
    let project = request.project_id.clone();
    let task = request.task_id.clone();
    let message_id = request.client_user_message_id.clone();
    run(
        &state.queue_additions,
        &state.submission_budget,
        request,
        move |mut input| async move {
            let state = worker_app.state::<AppState>();
            // 未取得连接时可安全原键重试；取得连接后任何未知结果都不得再次入队。
            let connection = state.codex_connection().await?;
            codex::read_task(&connection, project.clone(), task.clone())
                .await
                .map_err(AppError::from)?;
            let app_data = worker_app
                .path()
                .app_data_dir()
                .map_err(|_| AppError::FilesystemRequestFailed)?;
            super::attachment_commands::resolve_prompt_attachments(
                &app_data, &project, &task, &mut input,
            )
            .await?;
            let response = codex::add_queued_submission(&connection, &task, &input, &message_id)
                .await
                .map_err(AppError::from)?;
            serde_json::to_value(response).map_err(|_| AppError::CodexRequestFailed)
        },
    )
    .await
}

async fn run<E, F>(
    registry: &TurnStartRegistry,
    budget: &SubmissionBudget,
    request: QueueAddRequest,
    execute: E,
) -> Result<Value, Value>
where
    E: FnOnce(AgentPromptInput) -> F + Send + 'static,
    F: Future<Output = Result<Value, AppError>> + Send + 'static,
{
    if [
        &request.project_id,
        &request.task_id,
        &request.client_user_message_id,
    ]
    .iter()
    .any(|id| id.trim().is_empty() || id.len() > 1024)
    {
        return Err(
            json!({"code":"INVALID_REQUEST", "message":"Queue add requires bounded identities"}),
        );
    }
    // 独立登记表使用完整输入与客户端消息身份，不复制正文生成另一份 JSON。
    let identity = fingerprint_queue_content(
        &request.project_id,
        &request.task_id,
        &request.client_user_message_id,
        &request.input,
    )?;
    let admission = budget.reserve(identity.encoded_bytes())?;
    registry
        .run(&request.idempotency_key, identity, async move {
            // 许可属于后台工作，调用方取消等待不能提前释放预算。
            let _admission = admission;
            execute(request.input).await
        })
        .await
}

#[cfg(test)]
#[path = "queue_add_tests.rs"]
mod tests;
