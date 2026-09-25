use super::{error::AppError, prompt_submission::SubmissionBudget, turn_start::TurnStartRegistry};
use crate::infrastructure::codex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{future::Future, sync::Arc};
use tauri::{AppHandle, Manager};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PendingResolutionReference {
    pub project_id: String,
    pub task_id: String,
    pub turn_id: String,
    pub item_id: String,
    pub request_id: String,
    pub created_at: String,
}

impl PendingResolutionReference {
    pub(crate) fn matches(&self, request: &Value) -> bool {
        request["status"] == "pending"
            && request["projectId"] == self.project_id
            && request["taskId"] == self.task_id
            && request["turnId"] == self.turn_id
            && request["itemId"] == self.item_id
            && request["requestId"] == self.request_id
            && request["createdAt"] == self.created_at
    }
}

pub async fn resolve(
    app: AppHandle,
    reference: PendingResolutionReference,
    resolution: Value,
    key: String,
) -> Result<Value, Value> {
    let state = app.state::<super::state::AppState>();
    let worker_app = app.clone();
    let worker_reference = reference.clone();
    let resolution = Arc::new(resolution);
    let worker_resolution = Arc::clone(&resolution);
    run(
        &state.pending_resolutions,
        // 审批控制流使用独立预算，不能被等待审批的普通提交占满配额。
        &state.pending_resolution_budget,
        &reference,
        &resolution,
        &key,
        async move { execute(worker_app, worker_reference, worker_resolution).await },
    )
    .await
}

async fn execute(
    app: AppHandle,
    reference: PendingResolutionReference,
    resolution: Arc<Value>,
) -> Result<Value, AppError> {
    let state = app.state::<super::state::AppState>();
    // 同一临界区获取连接并核对请求身份，不能取走其他任务或新一代请求。
    let (connection, pending) = state.claim_pending_resolution(&reference).await?;
    let result = async {
        let response =
            codex::response_for_resolution(&pending, &resolution).map_err(AppError::from)?;
        if pending.request["type"] == "plugin_install_suggestion"
            && resolution["action"] == "accept"
            && pending.request["toolType"] == "plugin"
        {
            let marketplace = pending.request["remoteMarketplaceName"]
                .as_str()
                .ok_or(AppError::CodexRequestFailed)?;
            let plugin = pending.request["remotePluginId"]
                .as_str()
                .ok_or(AppError::CodexRequestFailed)?;
            codex::install_official_plugin(
                &connection,
                marketplace,
                None,
                plugin,
                pending.request["suggestionId"].as_str(),
            )
            .await
            .map_err(AppError::from)?;
        }
        connection
            .respond(pending.rpc_id, &response)
            .await
            .map_err(AppError::from)?;
        Ok(())
    }
    .await;
    if let Err(error) = result {
        state.restore_pending_resolution(&connection, pending).await;
        return Err(error);
    }
    let request = state
        .publish_pending_resolution(&connection, &pending)
        .await?;
    Ok(serde_json::json!({"request":request}))
}

async fn run<F>(
    registry: &TurnStartRegistry,
    budget: &SubmissionBudget,
    reference: &PendingResolutionReference,
    resolution: &Value,
    key: &str,
    execute: F,
) -> Result<Value, Value>
where
    F: Future<Output = Result<Value, AppError>> + Send + 'static,
{
    if [
        &reference.project_id,
        &reference.task_id,
        &reference.turn_id,
        &reference.item_id,
        &reference.request_id,
        &reference.created_at,
    ]
    .iter()
    .any(|value| value.trim().is_empty() || value.len() > 1024)
    {
        return Err(
            serde_json::json!({"code":"INVALID_REQUEST", "message":"Pending resolution requires bounded request identities"}),
        );
    }
    let identity = super::turn_start::fingerprint_pending_resolution(
        &reference.project_id,
        &reference.task_id,
        reference,
        resolution,
    )?;
    let admission = budget.reserve(identity.encoded_bytes())?;
    // 许可随原生 worker 持有；取消 WebView 等待不会中断回应或提前释放执行预算。
    registry
        .run(key, identity, async move {
            let _admission = admission;
            execute.await
        })
        .await
}

#[cfg(test)]
#[path = "pending_resolution_tests.rs"]
mod tests;
