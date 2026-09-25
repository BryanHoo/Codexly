use super::task_creation::CreationResult;
use super::{sidebar_commands, state::AppState};
use crate::domain::conversation::{AgentPromptInput, AgentTurnOptions};
use crate::domain::sidebar::AgentTask;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::future::Future;
use std::sync::Arc;
use tauri::{AppHandle, Manager, ipc::Channel};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};

pub struct SubmissionBudget {
    requests: Arc<Semaphore>,
    bytes: Arc<Semaphore>,
}

impl Default for SubmissionBudget {
    fn default() -> Self {
        Self {
            requests: Arc::new(Semaphore::new(16)),
            bytes: Arc::new(Semaphore::new(8 * 1024 * 1024)),
        }
    }
}

impl SubmissionBudget {
    pub(super) fn reserve(
        &self,
        bytes: usize,
    ) -> Result<(OwnedSemaphorePermit, OwnedSemaphorePermit), Value> {
        let exhausted = || json!({"code": "IDEMPOTENCY_CAPACITY_EXCEEDED", "message": "Task submission capacity is exhausted; retry later"});
        let bytes = u32::try_from(bytes).map_err(|_| exhausted())?;
        // 不排队保留输入；任一预算不足立即拒绝，已取得的许可自动释放。
        let request = Arc::clone(&self.requests)
            .try_acquire_owned()
            .map_err(|_| exhausted())?;
        let input = Arc::clone(&self.bytes)
            .try_acquire_many_owned(bytes)
            .map_err(|_| exhausted())?;
        Ok((request, input))
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SubmissionRequest {
    project_id: String,
    task_id: Option<String>,
    input: AgentPromptInput,
    turn_options: AgentTurnOptions,
    idempotency_keys: SubmissionKeys,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SubmissionKeys {
    start_task: Option<String>,
    start_turn: String,
}

impl SubmissionRequest {
    fn validate(&self) -> Result<usize, Value> {
        let valid_key = |key: &str| !key.trim().is_empty() && key.len() <= 128;
        if !valid_key(&self.idempotency_keys.start_turn)
            || (self.task_id.is_none()
                && !self
                    .idempotency_keys
                    .start_task
                    .as_deref()
                    .is_some_and(valid_key))
        {
            return Err(
                json!({"code": "INVALID_REQUEST", "message": "Prompt submission requires bounded idempotency keys"}),
            );
        }
        // 在创建前检查输入预算，避免明显无效的首轮请求遗留空任务。
        let identity = super::turn_start::fingerprint(
            &self.project_id,
            self.task_id.as_deref().unwrap_or("new-task"),
            &self.input,
            &self.turn_options,
        )?;
        Ok(identity.encoded_bytes())
    }
}

#[tauri::command(rename_all = "camelCase")]
pub async fn submit_prompt(
    app: AppHandle,
    request: SubmissionRequest,
    on_task_created: Channel<AgentTask>,
) -> Result<SubmissionResponse, Value> {
    let bytes = request.validate()?;
    // 覆盖创建等待阶段，直到提交返回才释放；阶段内部另有各自的有界登记表。
    let _admission = app.state::<AppState>().submission_budget.reserve(bytes)?;
    let creation_app = app.clone();
    let creation_project = request.project_id.clone();
    submit(
        request.task_id,
        async move {
            let state = creation_app.state::<AppState>();
            sidebar_commands::start_task(
                creation_app.clone(),
                creation_project,
                request.idempotency_keys.start_task.unwrap_or_default(),
                state,
            )
            .await
        },
        move |task| {
            // 通知只是展示优化；失败不能撤销创建或阻止首轮，最终响应仍携带任务摘要。
            if let Err(error) = on_task_created.send(task.clone()) {
                crate::infrastructure::diagnostics::record_error(
                    "prompt_task_notify_failed",
                    error,
                );
            }
        },
        move |task_id| async move {
            let state = app.state::<AppState>();
            sidebar_commands::start_turn(
                app.clone(),
                request.project_id,
                task_id,
                request.input,
                request.turn_options,
                request.idempotency_keys.start_turn,
                state,
            )
            .await
        },
    )
    .await
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmissionResponse {
    created_task: Option<AgentTask>,
    outcome: SubmissionOutcome,
}

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum SubmissionOutcome {
    Started { result: Value },
    Failed { error: Value },
}

pub(super) async fn submit<C, N, S, F>(
    task_id: Option<String>,
    create: C,
    notify: N,
    start: S,
) -> Result<SubmissionResponse, Value>
where
    C: Future<Output = CreationResult>,
    N: FnOnce(&AgentTask),
    S: FnOnce(String) -> F,
    F: Future<Output = Result<Value, Value>>,
{
    let (task_id, created_task) = match task_id {
        Some(task_id) => (task_id, None),
        None => {
            let response = create.await?;
            notify(&response.task);
            (response.task.id.clone(), Some(response.task))
        }
    };
    let outcome = match start(task_id).await {
        Ok(result) => SubmissionOutcome::Started { result },
        Err(error) => SubmissionOutcome::Failed { error },
    };
    Ok(SubmissionResponse {
        created_task,
        outcome,
    })
}

#[cfg(test)]
#[path = "prompt_submission_tests.rs"]
mod tests;
