use super::error::AppError;
use crate::infrastructure::local_catalog::{LocalCatalog, sidebar::map_task};
use serde_json::{Value, json};

pub(super) fn validate(method: &str, params: &Value) -> Result<(), AppError> {
    let keys: &[&str] = match method {
        "task.pin" => &["taskId", "pinned"],
        "task.rename" => &["taskId", "title"],
        "task.archive" | "task.unarchive" | "task.delete" => &["taskId"],
        _ => return Ok(()),
    };
    let valid_keys = params
        .as_object()
        .is_some_and(|values| values.keys().all(|key| keys.contains(&key.as_str())));
    let valid_input = match method {
        "task.pin" => params["pinned"].is_boolean(),
        // 与前端及共享 Schema 的 UTF-16 长度一致，不把表情字符算成单个单元。
        "task.rename" => params["title"].as_str().is_some_and(|title| {
            !title.trim().is_empty() && title.encode_utf16().take(201).count() <= 200
        }),
        _ => true,
    };
    if !valid_keys || !valid_input {
        return Err(AppError::Acp("Invalid ACP task management input".into()));
    }
    Ok(())
}

/// 只在共享宿主确认后调用；不重做执行、不启动模型、不把裸元数据冒充旧 DTO。
pub(super) async fn response(
    catalog: &LocalCatalog,
    project: &str,
    task: &str,
    method: &str,
) -> Result<Option<Value>, AppError> {
    let status = match method {
        "task.archive" => Some("archived"),
        "task.delete" => Some("deleted"),
        _ => None,
    };
    if let Some(status) = status {
        // 删除成功后目录已不存在，状态响应使用原请求身份，不能再查目录或伪造列表。
        return Ok(Some(json!({"status":status,"taskId":task})));
    }
    if !matches!(method, "task.pin" | "task.rename" | "task.unarchive") {
        return Ok(None);
    }
    let task = map_task(&catalog.owned_task(project, task).await?)?;
    Ok(Some(json!({"task":task})))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn management_response_should_wrap_authoritative_catalog_and_preserve_identity() {
        let directory = tempfile::tempdir().unwrap();
        let catalog = LocalCatalog::at(directory.path()).unwrap();
        catalog.call("project.put", json!({"id":"p","name":"项目","path":directory.path().to_string_lossy(),"createdAt":"2026-11-12T00:00:00Z"})).await.unwrap();
        for engine in ["codex", "claude"] {
            let id = format!("task-{engine}");
            catalog.call("task.put", json!({"id":id,"provider":engine,"projectId":"p","sessionId":"native-old",
                "cwd":"/workspace","title":"权威标题","updatedAt":1,"pinned":true,"archived":false,"status":"idle"})).await.unwrap();
            for method in ["task.pin", "task.rename", "task.unarchive"] {
                let result = response(&catalog, "p", &id, method).await.unwrap().unwrap();
                assert_eq!(result["task"]["id"], id);
                assert_eq!(result["task"]["title"], "权威标题");
                assert_eq!(result["task"]["projectId"], "p");
                assert_eq!(result["task"]["pinned"], true);
                assert_eq!(result["task"]["workspacePath"], "/workspace");
                assert!(result["task"].get("sessionId").is_none());
            }
            assert!(response(&catalog, "other", &id, "task.pin").await.is_err());
            assert_eq!(
                catalog.call("task.read", json!({"id":id})).await.unwrap()["sessionId"],
                "native-old"
            );
        }
    }

    #[tokio::test]
    async fn temporary_management_response_should_preserve_scope_and_host_path() {
        let directory = tempfile::tempdir().unwrap();
        let catalog = LocalCatalog::at(directory.path()).unwrap();
        let cwd = r"C:\work\临时任务";
        catalog.call("task.put", json!({"id":"temporary-task","provider":"claude","projectId":null,"sessionId":"native-history",
            "cwd":cwd,"title":"临时历史","updatedAt":1,"pinned":false,"archived":false,"status":"idle"})).await.unwrap();
        let result = response(&catalog, "temporary", "temporary-task", "task.rename")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(result["task"]["projectId"], "temporary");
        assert_eq!(result["task"]["workspacePath"], cwd);
        assert_eq!(result["task"]["engine"], "claude");
        assert!(
            catalog
                .call("task.read", json!({"id":"temporary-task"}))
                .await
                .unwrap()["projectId"]
                .is_null()
        );
    }

    #[tokio::test]
    async fn deleted_response_should_not_read_removed_history_or_change_other_responses() {
        let directory = tempfile::tempdir().unwrap();
        let catalog = LocalCatalog::at(directory.path()).unwrap();
        for (method, status) in [("task.archive", "archived"), ("task.delete", "deleted")] {
            assert_eq!(
                response(&catalog, "p", "t", method).await.unwrap(),
                Some(json!({"status":status,"taskId":"t"}))
            );
        }
        assert!(response(&catalog, "p", "t", "task.rename").await.is_err());
        assert!(
            response(&catalog, "p", "t", "task.read")
                .await
                .unwrap()
                .is_none()
        );
    }
}
