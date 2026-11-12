use super::{error::AppError, state::AppState};
use crate::infrastructure::{app_data, local_catalog::LocalCatalog, temporary_workspace_settings};
use serde_json::{Value, json};
use tauri::{AppHandle, Manager};

fn validate_request(method: &str, params: &Value) -> Result<(), AppError> {
    if !matches!(
        method,
        "task.read"
            | "attachment.export"
            | "task.rename"
            | "task.archive"
            | "task.unarchive"
            | "task.delete"
            | "session.config.read"
            | "session.state.read"
            | "session.config.write"
            | "turn.start"
            | "prompt.start"
            | "turn.interrupt"
            | "request.resolve"
            | "queue.add"
            | "queue.list"
            | "queue.start"
            | "queue.update"
            | "queue.delete"
            | "queue.move"
            | "queue.reorder"
    ) || !params["taskId"].as_str().is_some_and(|id| !id.is_empty())
    {
        return Err(AppError::Acp("Invalid ACP task request".into()));
    }
    if method == "prompt.start"
        && (!params["idempotencyKey"]
            .as_str()
            .is_some_and(|key| !key.trim().is_empty() && key.len() <= 128)
            || !params.as_object().is_some_and(|values| {
                values.keys().all(|key| {
                    matches!(
                        key.as_str(),
                        "taskId" | "input" | "idempotencyKey" | "initialConfig" | "recoveryKey"
                    )
                })
            }))
    {
        return Err(AppError::Acp("Invalid ACP prompt identity".into()));
    }
    if method == "prompt.start"
        && params.get("recoveryKey").is_some_and(|key| {
            !key.as_str()
                .is_some_and(|key| !key.trim().is_empty() && key.len() <= 128)
        })
    {
        return Err(AppError::Acp("Invalid ACP recovery identity".into()));
    }
    if method == "prompt.start"
        && params.get("initialConfig").is_some_and(|config| {
            config.as_object().is_none_or(|values| {
                values.iter().any(|(key, value)| {
                    key.is_empty()
                        || key.encode_utf16().take(257).count() > 256
                        || !(value.is_boolean()
                            || value.as_str().is_some_and(|text| {
                                text.encode_utf16().take(16385).count() <= 16384
                            }))
                })
            })
        })
    {
        return Err(AppError::Acp("Invalid ACP initial config".into()));
    }
    if matches!(
        method,
        "turn.start" | "prompt.start" | "queue.add" | "queue.update"
    ) {
        let input = &params["input"];
        if !input["text"].is_string()
            || !["files", "images", "textAttachments", "skills"]
                .iter()
                .all(|key| {
                    input
                        .get(key)
                        .is_none_or(|value| value.as_array().is_some_and(Vec::is_empty))
                })
        {
            return Err(AppError::Acp(
                "ACP task attachments require authorized storage".into(),
            ));
        }
    }
    Ok(())
}

/// 作用域与目录归属只由原生数据构造；前端不能选择执行目录或传入宿主作用域。
#[tauri::command(rename_all = "camelCase")]
pub async fn acp_task_request(
    app: AppHandle,
    project_id: String,
    method: String,
    params: Value,
    request_id: Option<String>,
) -> Result<Value, AppError> {
    request_with_input(app, project_id, method, params, request_id, None).await
}

/// 仅执行器可以提供已经恢复的输入；原 params 决定提交身份，前端没有覆盖入口。
pub(super) async fn start_plan_prompt(
    app: AppHandle,
    project: String,
    params: Value,
    input: Option<Value>,
) -> Result<Value, AppError> {
    request_with_input(app, project, "prompt.start".into(), params, None, input).await
}

async fn request_with_input(
    app: AppHandle,
    project_id: String,
    method: String,
    mut params: Value,
    request_id: Option<String>,
    prepared_input: Option<Value>,
) -> Result<Value, AppError> {
    validate_request(&method, &params)?;
    let cancellable = matches!(
        method.as_str(),
        "task.read" | "session.config.read" | "session.state.read" | "queue.list"
    );
    if request_id
        .as_ref()
        .is_some_and(|id| id.is_empty() || id.len() > 256)
        || (!cancellable && request_id.is_some())
    {
        return Err(AppError::Acp("Invalid task cancellation request".into()));
    }
    let state = app.state::<AppState>();
    // 先登记取消身份，再执行目录查询，避免查询期间取消却继续启动宿主。
    let operation = async {
        let directory = app_data::directory(&app).map_err(|_| AppError::FilesystemRequestFailed)?;
        let catalog = LocalCatalog::at(&directory)?;
        let task_id = params["taskId"]
            .as_str()
            .ok_or(AppError::FilesystemRequestFailed)?
            .to_owned();
        catalog.owned_task(&project_id, &task_id).await?;
        let submission = if method == "prompt.start" {
            let (mut identity, bytes) =
                super::acp_prompt_submission::identity(&project_id, &params)?;
            let permit = state
                .submission_budget
                .reserve(bytes)
                .map_err(|_| AppError::QueueRecoveryCapacityExceeded)?;
            let read_method = if let Some(source) = params.get("recoveryKey") {
                identity["sourceKey"] = source.clone();
                "acp.submission.recover"
            } else {
                "acp.submission.read"
            };
            // 完成结果在附件解析前重放，已消费或被清理的上传不能破坏幂等响应。
            if let Some(mut result) = super::acp_prompt_submission::replay(
                &catalog.call(read_method, identity.clone()).await?,
            )? {
                super::acp_view::normalize_response(&method, &mut result);
                return Ok(result);
            }
            Some((identity, permit))
        } else {
            None
        };
        let root = if project_id == "temporary" {
            let root = temporary_workspace_settings::read_root(&directory)
                .await
                .map_err(|_| AppError::FilesystemRequestFailed)?;
            tokio::fs::create_dir_all(&root)
                .await
                .map_err(|_| AppError::FilesystemRequestFailed)?;
            root
        } else {
            let project = catalog
                .call("project.read", json!({"id":project_id}))
                .await?;
            project["path"]
                .as_str()
                .filter(|path| !path.is_empty())
                .ok_or(AppError::FilesystemRequestFailed)?
                .into()
        };
        let root = root.to_string_lossy();
        let scope = json!({"id":project_id,"kind":if project_id=="temporary" {"temporary"} else {"project"},
        "rootPath":root,"runtimeWorkspaceRoots":[root]});
        // 队列与立即发送共用附件授权，不能让排队接口绕过上传和历史引用校验。
        if matches!(
            method.as_str(),
            "turn.start" | "prompt.start" | "queue.add" | "queue.update"
        ) {
            let (mut input, references) = super::acp_input::prepare(
                &directory,
                &project_id,
                &task_id,
                prepared_input.unwrap_or_else(|| params["input"].clone()),
            )
            .await?;
            for id in references {
                let exported = state
                    .acp
                    .host
                    .request(
                        &app,
                        "attachment.export",
                        Some(scope.clone()),
                        json!({"taskId":task_id,"attachmentId":id}),
                    )
                    .await?;
                let mut attachment = exported["attachment"].clone();
                attachment["id"] = exported["path"].clone();
                input.attachments.push(attachment);
            }
            params["input"] = super::acp_input::provider_input(input).await?;
        }
        state.remember_tasks(&project_id, [task_id.as_str()]).await;
        if let Some((identity, _)) = &submission
            && let Some(mut result) = super::acp_prompt_submission::replay(
                &catalog
                    .call("acp.submission.begin", identity.clone())
                    .await?,
            )?
        {
            super::acp_view::normalize_response(&method, &mut result);
            return Ok(result);
        }
        // 先提交持久登记再写入宿主；RPC 超时、断线或取消等待均不能清除此记录。
        let response = state
            .acp
            .host
            .request(&app, &method, Some(scope), params)
            .await;
        let mut result = match response {
            Err(AppError::Acp(ref message)) if message == "ACP_HOST_PROMPT_NOT_SUBMITTED" => {
                if let Some((identity, _)) = &submission {
                    catalog
                        .call("acp.submission.retry", identity.clone())
                        .await?;
                }
                return response;
            }
            result => result?,
        };
        // 宿主保留统一 ACP 数据，桌面视图转换集中在 IPC 返回边界并纳入幂等重放。
        super::acp_view::normalize_response(&method, &mut result);
        if let Some((mut identity, _)) = submission {
            identity["result"] = result.clone();
            super::acp_prompt_submission::replay(
                &catalog.call("acp.submission.complete", identity).await?,
            )?;
        }
        Ok(result)
    };
    if cancellable {
        state
            .run_cancellable(request_id.as_deref(), operation)
            .await
    } else {
        operation.await
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn configured_prompt_should_require_identity_and_reject_legacy_options() {
        let request = serde_json::json!({"taskId":"t","idempotencyKey":"once","input":{"text":"x","attachments":[],"skills":[]}});
        assert!(super::validate_request("prompt.start", &request).is_ok());
        let mut configured = request.clone();
        configured["initialConfig"] = serde_json::json!({"enabled":false});
        assert!(super::validate_request("prompt.start", &configured).is_ok());
        configured["initialConfig"] = serde_json::json!({"enabled":1});
        assert!(super::validate_request("prompt.start", &configured).is_err());
        let mut legacy = request.clone();
        legacy["options"] = serde_json::json!({"model":"old"});
        assert!(super::validate_request("prompt.start", &legacy).is_err());
        let mut missing = request;
        missing.as_object_mut().unwrap().remove("idempotencyKey");
        assert!(super::validate_request("prompt.start", &missing).is_err());
    }
    use serde_json::json;
    #[test]
    fn task_request_should_reject_raw_paths_and_unknown_methods() {
        assert!(super::validate_request("close", &json!({"taskId":"t"})).is_err());
        assert!(
            super::validate_request(
                "turn.start",
                &json!({"taskId":"t","input":{"text":"x","files":[{"path":"/secret"}]}})
            )
            .is_err()
        );
        assert!(super::validate_request("task.read", &json!({"taskId":"t"})).is_ok());
        assert!(super::validate_request("session.state.read", &json!({"taskId":"t"})).is_ok());
    }
    #[test]
    fn queue_should_accept_only_authorized_input_and_known_operations() {
        for method in ["queue.add", "queue.update"] {
            assert!(
                super::validate_request(
                    method,
                    &json!({"taskId":"t","input":{"text":"q","attachments":[]}})
                )
                .is_ok()
            );
            assert!(
                super::validate_request(
                    method,
                    &json!({"taskId":"t","input":{"text":"q","images":[{"path":"/secret"}]}})
                )
                .is_err()
            );
        }
        for method in [
            "queue.list",
            "queue.start",
            "queue.delete",
            "queue.move",
            "queue.reorder",
        ] {
            assert!(super::validate_request(method, &json!({"taskId":"t"})).is_ok());
        }
        assert!(super::validate_request("queue.clearAnything", &json!({"taskId":"t"})).is_err());
    }
}

/// 创建只写应用目录，不启动 ACP 或模型；重试必须沿用原幂等键。
#[tauri::command(rename_all = "camelCase")]
pub async fn create_acp_task(
    app: AppHandle,
    project_id: String,
    engine: String,
    idempotency_key: String,
    workspace_path: Option<String>,
) -> Result<crate::domain::sidebar::AgentTask, AppError> {
    let directory = app_data::directory(&app).map_err(|_| AppError::FilesystemRequestFailed)?;
    let catalog = LocalCatalog::at(&directory)?;
    let task = if let Some(path) = workspace_path {
        super::acp_task_creation::create_with_workspace(
            &directory,
            &catalog,
            &project_id,
            &engine,
            &idempotency_key,
            Some(&path),
        )
        .await?
    } else {
        super::acp_task_creation::create(
            &directory,
            &catalog,
            &project_id,
            &engine,
            &idempotency_key,
        )
        .await?
    };
    crate::infrastructure::local_catalog::sidebar::map_task(&task).map_err(Into::into)
}
