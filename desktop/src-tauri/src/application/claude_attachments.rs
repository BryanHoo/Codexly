use serde_json::{Value, json};
use tauri::{AppHandle, Manager, http};

use super::{claude_tasks, error::AppError, state::AppState};

/// 校验本地任务归属后由共享 Provider 复验正文，宿主只返回导出路径，不经过 Base64 IPC。
pub async fn export(
    app: &AppHandle,
    project: &str,
    task_id: &str,
    attachment_id: &str,
) -> Result<Value, AppError> {
    let task = claude_tasks::task(app, project, task_id).await?;
    if task["provider"] != "claude" {
        return Err(AppError::FilesystemRequestFailed);
    }
    app.state::<AppState>()
        .claude
        .request(
            app,
            "attachment.export",
            Some(claude_tasks::scope(&task)),
            json!({"taskId":task_id,"attachmentId":attachment_id}),
        )
        .await
}

fn selectors(uri: &http::Uri) -> Option<(String, String, String)> {
    let url = tauri::Url::parse(&format!("http://localhost/?{}", uri.query()?)).ok()?;
    let field = |name| {
        url.query_pairs()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.into_owned())
            .filter(|value| !value.is_empty() && value.len() <= 256)
    };
    Some((
        field("projectId")?,
        field("taskId")?,
        field("attachmentId")?,
    ))
}

pub async fn respond(app: &AppHandle, request: http::Request<Vec<u8>>) -> http::Response<Vec<u8>> {
    let result = async {
        if request.method() != http::Method::GET {
            return Err(AppError::FilesystemRequestFailed);
        }
        let (project, task, attachment) =
            selectors(request.uri()).ok_or(AppError::FilesystemRequestFailed)?;
        let exported = export(app, &project, &task, &attachment).await?;
        let path = exported["path"]
            .as_str()
            .ok_or(AppError::FilesystemRequestFailed)?;
        let bytes = tokio::fs::read(path)
            .await
            .map_err(|_| AppError::FilesystemRequestFailed)?;
        Ok::<_, AppError>((
            bytes,
            exported["mediaType"]
                .as_str()
                .unwrap_or("application/octet-stream")
                .to_owned(),
        ))
    }
    .await;
    let mut response = http::Response::new(Vec::new());
    // 文本/PDF 预览使用 fetch；仅返回已按任务鉴权的正文，禁止浏览器长期缓存已撤销的引用。
    response.headers_mut().insert(
        http::header::ACCESS_CONTROL_ALLOW_ORIGIN,
        http::HeaderValue::from_static("*"),
    );
    response.headers_mut().insert(
        http::header::CACHE_CONTROL,
        http::HeaderValue::from_static("no-store"),
    );
    response.headers_mut().insert(
        http::header::X_CONTENT_TYPE_OPTIONS,
        http::HeaderValue::from_static("nosniff"),
    );
    match result {
        Ok((bytes, media_type)) => {
            *response.body_mut() = bytes;
            response.headers_mut().insert(
                http::header::CONTENT_TYPE,
                http::HeaderValue::from_str(&media_type)
                    .unwrap_or_else(|_| http::HeaderValue::from_static("application/octet-stream")),
            );
        }
        Err(_) => *response.status_mut() = http::StatusCode::NOT_FOUND,
    }
    response
}

#[cfg(test)]
mod tests {
    use super::selectors;

    #[test]
    fn attachment_query_should_preserve_scoped_identity() {
        let uri = "task-attachment://localhost/read?projectId=%E9%A1%B9%E7%9B%AE+%E7%A9%BA%E6%A0%BC&taskId=task-1&attachmentId=history-abc".parse().unwrap();
        assert_eq!(
            selectors(&uri),
            Some(("项目 空格".into(), "task-1".into(), "history-abc".into()))
        );
    }

    #[test]
    fn attachment_query_should_require_project_task_and_attachment() {
        for uri in [
            "http://task-attachment.localhost/read",
            "http://task-attachment.localhost/read?projectId=p&taskId=t",
            "http://task-attachment.localhost/read?projectId=p&taskId=&attachmentId=a",
        ] {
            assert_eq!(selectors(&uri.parse().unwrap()), None);
        }
    }
}
