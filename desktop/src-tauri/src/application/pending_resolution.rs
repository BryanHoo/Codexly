use super::{error::AppError, prompt_submission::SubmissionBudget, turn_start::TurnStartRegistry};
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

/// ACP 权限请求共用审批幂等登记和独立预算，窗口关闭后不会重复发出授权。
#[tauri::command(rename_all = "camelCase")]
pub async fn resolve_pending_request(
    app: AppHandle,
    request: PendingResolutionReference,
    resolution: Value,
    idempotency_key: String,
    acp_request_type: Option<String>,
) -> Result<Value, Value> {
    let acp_type = match acp_request_type.as_deref() {
        Some("mcp_elicitation") => "mcp_elicitation",
        None => "tool_approval",
        _ => {
            return Err(
                serde_json::json!({"code":"INVALID_REQUEST", "message":"Invalid ACP request type"}),
            );
        }
    };
    let reference = request;
    let key = idempotency_key;
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
        async move {
            let mut wire_resolution = (*worker_resolution).clone();
            if acp_type == "mcp_elicitation" {
                // ACP 宿主使用 Web 与桌面共用的结构化回应契约。
                let fields = wire_resolution
                    .as_object_mut()
                    .ok_or(AppError::CodexRequestFailed)?;
                let default_content =
                    if fields.get("action").and_then(Value::as_str) == Some("accept") {
                        serde_json::json!({})
                    } else {
                        Value::Null
                    };
                fields.entry("content").or_insert(default_content);
            }
            let request = super::acp_task_commands::acp_task_request(
                worker_app,
                worker_reference.project_id.clone(),
                "request.resolve".into(),
                serde_json::json!({
                    "projectId":worker_reference.project_id,
                    "taskId":worker_reference.task_id,
                    "turnId":worker_reference.turn_id,
                    "itemId":worker_reference.item_id,
                    "requestId":worker_reference.request_id,
                    "type":acp_type,
                    "resolution":wire_resolution,
                }),
                None,
            )
            .await?;
            Ok(serde_json::json!({"request":request}))
        },
    )
    .await
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
