use super::error::AppError;
use crate::infrastructure::local_catalog::LocalCatalog;
use serde_json::{Value, json};
use std::path::Path;

pub(super) async fn apply(
    directory: &Path,
    catalog: &LocalCatalog,
    intent: Value,
) -> Result<Value, AppError> {
    let project = intent["projectId"]
        .as_str()
        .ok_or(AppError::ScheduledTaskInvalid)?;
    let id = intent["scheduleId"]
        .as_str()
        .ok_or(AppError::ScheduledTaskInvalid)?;
    let run = intent["runId"]
        .as_str()
        .ok_or(AppError::ScheduledTaskInvalid)?;
    let (_, task) = super::acp_plan_executor::identity(project, id, run)?;
    // 清理失败保留意图和 unknown，后续调用只重试清理，不能重新进入 prompt。
    if let Err(error) = super::acp_plan_resources::discard_task(directory, &task).await {
        return super::acp_plan_executor::finish(
            catalog,
            id,
            run,
            "unknown",
            intent["taskId"].clone(),
            json!(error.to_string()),
        )
        .await;
    }
    super::acp_plan_executor::finish(
        catalog,
        id,
        run,
        intent["status"]
            .as_str()
            .ok_or(AppError::ScheduledTaskInvalid)?,
        intent["taskId"].clone(),
        intent["error"].clone(),
    )
    .await
}

pub(super) async fn record(
    directory: &Path,
    catalog: &LocalCatalog,
    intent: Value,
) -> Result<Value, AppError> {
    let intent = catalog.call("acp.plan.completion.put", intent).await?;
    if intent.is_null() {
        return Err(AppError::AcpSubmissionConflict);
    }
    apply(directory, catalog, intent).await
}
