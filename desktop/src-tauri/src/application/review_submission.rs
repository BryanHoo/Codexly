use super::{
    error::AppError,
    turn_start::{TurnStartRegistry, fingerprint_review},
};
use super::{
    prompt_submission::{SubmissionResponse, submit},
    sidebar_commands,
    state::AppState,
};
use crate::{domain::sidebar::AgentTask, infrastructure::codex};
use serde::Deserialize;
use serde_json::{Value, json};
use std::future::Future;
use tauri::{AppHandle, Manager, ipc::Channel};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReviewRequest {
    project_id: String,
    task_id: Option<String>,
    target: Value,
    idempotency_key: String,
}

impl ReviewRequest {
    fn validate(&self) -> Result<usize, Value> {
        if self.idempotency_key.trim().is_empty() || self.idempotency_key.len() > 128 {
            return Err(invalid());
        }
        validate_target(&self.target)?;
        Ok(fingerprint_review(
            &self.project_id,
            self.task_id.as_deref().unwrap_or("new-task"),
            &self.target,
        )?
        .encoded_bytes())
    }
}

fn invalid() -> Value {
    json!({"code":"INVALID_REQUEST", "message":"Review submission requires valid identities and target"})
}

fn validate_target(target: &Value) -> Result<(), Value> {
    let fields = target.as_object().ok_or_else(invalid)?;
    // 与协议字段白名单一致，先验证目标再创建，避免畸形 Review 遗留空任务。
    if fields.iter().any(|(key, value)| {
        !matches!(
            key.as_str(),
            "type" | "branch" | "sha" | "title" | "instructions"
        ) || !value.as_str().is_some_and(|value| !value.is_empty())
    }) {
        return Err(invalid());
    }
    let required = match fields.get("type").and_then(Value::as_str) {
        Some("uncommitted_changes") => return Ok(()),
        Some("base_branch") => "branch",
        Some("commit") => "sha",
        Some("custom") => "instructions",
        _ => return Err(invalid()),
    };
    fields
        .contains_key(required)
        .then_some(())
        .ok_or_else(invalid)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn submit_review(
    app: AppHandle,
    request: ReviewRequest,
    on_task_created: Channel<AgentTask>,
) -> Result<SubmissionResponse, Value> {
    let bytes = request.validate()?;
    let _admission = app.state::<AppState>().submission_budget.reserve(bytes)?;
    let creation_app = app.clone();
    let creation_project = request.project_id.clone();
    let creation_key = request.idempotency_key.clone();
    submit(
        request.task_id,
        async move {
            let state = creation_app.state::<AppState>();
            sidebar_commands::start_task(
                creation_app.clone(),
                creation_project,
                creation_key,
                state,
            )
            .await
        },
        move |task| {
            if let Err(error) = on_task_created.send(task.clone()) {
                crate::infrastructure::diagnostics::record_error(
                    "review_task_notify_failed",
                    error,
                );
            }
        },
        move |task_id| async move {
            let state = app.state::<AppState>();
            let worker_app = app.clone();
            let project_id = request.project_id.clone();
            let worker_task = task_id.clone();
            start(
                &state.review_starts,
                &request.idempotency_key,
                &request.project_id,
                &task_id,
                request.target,
                move |target| async move {
                    let state = worker_app.state::<AppState>();
                    let connection = state.codex_connection().await?;
                    let response =
                        codex::start_review(&connection, &project_id, &worker_task, &target)
                            .await
                            .map_err(AppError::from)?;
                    serde_json::to_value(response).map_err(|_| AppError::CodexRequestFailed)
                },
            )
            .await
        },
    )
    .await
}

async fn start<E, F>(
    registry: &TurnStartRegistry,
    key: &str,
    project_id: &str,
    task_id: &str,
    target: Value,
    execute: E,
) -> Result<Value, Value>
where
    E: FnOnce(Value) -> F,
    F: Future<Output = Result<Value, AppError>> + Send + 'static,
{
    validate_target(&target)?;
    let identity = fingerprint_review(project_id, task_id, &target)?;
    // Review 与普通 Turn 使用独立登记表，同键重放不再次发送 review/start。
    registry.run(key, identity, execute(target)).await
}

#[cfg(test)]
#[path = "review_submission_tests.rs"]
mod tests;
