use super::{error::AppError, prompt_submission::SubmissionBudget};
use crate::domain::conversation::AgentPromptInput;
use serde_json::Value;
use std::{future::Future, sync::Arc};

#[path = "queued_steer_recovery.rs"]
mod recovery;
pub(crate) use recovery::{IdleStartLease, QueuedSteerRegistry};

pub(super) struct QueuedSteerRequest {
    pub project_id: String,
    pub task_id: String,
    pub turn_id: String,
    pub input: AgentPromptInput,
    pub idempotency_key: String,
    pub queued_submission_id: String,
}

pub(super) async fn run<E, F, C, D>(
    registry: Arc<QueuedSteerRegistry>,
    budget: &SubmissionBudget,
    request: QueuedSteerRequest,
    execute: E,
    cleanup: C,
) -> Result<Value, Value>
where
    E: FnOnce(AgentPromptInput) -> F + Send + 'static,
    F: Future<Output = Result<Value, AppError>> + Send + 'static,
    C: FnOnce() -> D + Send + 'static,
    D: Future<Output = Result<(), AppError>> + Send + 'static,
{
    let identity = super::turn_start::fingerprint_queued_steer(
        &request.project_id,
        &request.task_id,
        &request.turn_id,
        &request.queued_submission_id,
        &request.input,
    )?;
    registry
        .starts
        .check_identity(&request.idempotency_key, &identity)?;
    let admission = budget.reserve(identity.encoded_bytes())?;
    let queue_identity = super::turn_start::fingerprint_queue_start(
        &request.project_id,
        &request.task_id,
        Some(&request.queued_submission_id),
    )?
    .digest();
    let content = super::turn_start::fingerprint_queue_content(
        &request.project_id,
        &request.task_id,
        &request.queued_submission_id,
        &request.input,
    )?
    .digest();
    let slot = registry
        .acquire(queue_identity)
        .map_err(|error| serde_json::json!(error))?;
    // 协调任务持有入口预算；调用方取消等待不能中断已接受追加后的清理。
    tokio::spawn(async move {
        let _admission = admission;
        let mut state = tokio::time::timeout(std::time::Duration::from_secs(120), slot.lock())
            .await.map_err(|_| recovery::uncertain())?;
        if state.idle_start_attempted { return Err(recovery::uncertain()); }
        let result = if let Some(accepted) = &state.accepted {
            if accepted.content != content {
                return Err(serde_json::json!({"code":"IDEMPOTENCY_CONFLICT", "message":"Queued item content differs from the accepted prompt; inspect it before cleanup"}));
            }
            let mut result: Value = serde_json::from_slice(&accepted.result).map_err(|_| recovery::uncertain())?;
            result.as_object_mut().ok_or_else(recovery::uncertain)?.insert("cleanupOnly".into(), Value::Bool(true));
            result
        } else {
            if state.first_key.as_ref().is_some_and(|key| key != &request.idempotency_key) {
                return Err(recovery::uncertain());
            }
            state.first_key = Some(request.idempotency_key.clone());
            let worker_slot = Arc::clone(&slot);
            let result = registry.starts.run(&request.idempotency_key, identity, async move {
                let _lease = worker_slot;
                execute(request.input).await
            }).await?;
            // 先记录已接受事实再清理；换回合或 WebView 重建产生的新键不能再次追加。
            let encoded = serde_json::to_vec(&result).map_err(|_| recovery::uncertain())?;
            state.accepted = Some(recovery::Accepted { content, result: encoded });
            result
        };
        // 只缓存追加阶段，清理失败后同键重试只补做删除，不再次发送输入。
        cleanup().await.map_err(|_| serde_json::json!({
            "code": "QUEUE_CLEANUP_FAILED",
            "message": "Prompt was accepted, but queued item cleanup failed; retry this submission to finish cleanup"
        }))?;
        Ok(result)
    }).await.map_err(|_| serde_json::json!({
        "code": "TURN_START_UNCERTAIN",
        "message": "Queued steer result is unavailable; refresh the task before starting a new attempt"
    }))?
}

#[cfg(test)]
#[path = "queued_steer_tests.rs"]
mod tests;
