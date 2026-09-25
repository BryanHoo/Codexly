use super::{error::AppError, queued_steer::QueuedSteerRegistry};
use crate::{domain::conversation::AgentPromptInput, infrastructure::codex};
use serde_json::{Value, json};

pub(super) enum Selection {
    Start(String, super::queued_steer::IdleStartLease),
    Cleanup(String),
}

pub(super) async fn select(
    registry: &QueuedSteerRegistry,
    connection: &codex::AppServerConnection,
    project: &str,
    task: &str,
    selected: Option<String>,
) -> Result<Selection, AppError> {
    let selected = match selected {
        Some(id) => id,
        // 固定本次看到的首项；后续队列变化不能让同次请求消费另一个目标。
        None => codex::read_queued_submissions(connection, task)
            .await
            .map_err(AppError::from)?
            .data
            .into_iter()
            .next()
            .map(|item| item.id)
            .ok_or(AppError::QueueEmpty)?,
    };
    match registry
        .reserve_idle_start(project, task, &selected)
        .await?
    {
        Some(lease) => Ok(Selection::Start(selected, lease)),
        None => Ok(Selection::Cleanup(selected)),
    }
}

pub(super) async fn cleanup(
    registry: &QueuedSteerRegistry,
    connection: &codex::AppServerConnection,
    project: &str,
    task: &str,
    id: &str,
) -> Result<(), Value> {
    let lease = registry
        .accepted_for_queue(project, task, id)
        .await
        .map_err(|error| json!(error))?
        .ok_or_else(|| json!(AppError::QueueRecoveryUncertain))?;
    let snapshot = codex::read_queued_submissions(connection, task)
        .await
        .map_err(|_| cleanup_failed())?;
    let Some(item) = snapshot.data.into_iter().find(|item| item.id == id) else {
        return Ok(());
    };
    let input = AgentPromptInput {
        text: item.text,
        attachments: item.attachments,
        skills: item.skills,
    };
    let content = super::turn_start::fingerprint_queue_content(project, task, id, &input)?;
    if content.digest() != lease.content {
        return Err(json!(AppError::QueuedContentChanged));
    }
    // 仅删除已确认且内容仍一致的项；上游尚无原子内容 CAS，外部编辑竞态仍可能存在。
    codex::delete_queued_submission(connection, task, id)
        .await
        .map_err(|_| cleanup_failed())?;
    Ok(())
}

fn cleanup_failed() -> Value {
    json!({"code":"QUEUE_CLEANUP_FAILED", "message":"Prompt was accepted, but queued item cleanup failed; retry to finish cleanup"})
}

#[cfg(test)]
#[path = "queue_start_recovery_tests.rs"]
mod tests;
