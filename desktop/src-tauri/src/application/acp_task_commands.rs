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
    if matches!(method, "turn.start" | "queue.add" | "queue.update") {
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
    mut params: Value,
    request_id: Option<String>,
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
        if matches!(method.as_str(), "turn.start" | "queue.add" | "queue.update") {
            let (mut input, references) = super::acp_input::prepare(
                &directory,
                &project_id,
                &task_id,
                params["input"].clone(),
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
        state
            .acp
            .host
            .request(&app, &method, Some(scope), params)
            .await
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
) -> Result<crate::domain::sidebar::AgentTask, AppError> {
    let directory = app_data::directory(&app).map_err(|_| AppError::FilesystemRequestFailed)?;
    let catalog = LocalCatalog::at(&directory)?;
    let task = super::acp_task_creation::create(
        &directory,
        &catalog,
        &project_id,
        &engine,
        &idempotency_key,
    )
    .await?;
    crate::infrastructure::local_catalog::sidebar::map_task(&task).map_err(Into::into)
}
