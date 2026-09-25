use super::{
    agent_settings::read_agent_runtime_settings,
    connection::{AppServerConnection, ConnectionError},
    conversation_commands::resume_task,
    tasks::is_task_loaded,
};

impl AppServerConnection {
    /// 补齐新线程 live snapshot 缺失的项目；绝不覆盖 Provider 返回的非空归属。
    pub(super) fn restore_new_task_project(
        &self,
        task_id: &str,
        project_id: &mut Option<String>,
    ) -> Result<(), ConnectionError> {
        let mut projects = self
            .new_task_projects
            .lock()
            .map_err(|_| ConnectionError::StateUnavailable)?;
        if project_id.is_some() {
            // 原生元数据已物化，释放启动期记录，后续只信任 Provider。
            projects.remove(task_id);
        } else if let Some(project) = projects.get(task_id) {
            *project_id = Some(project.clone());
        }
        Ok(())
    }
}

/// 打开任务时确认本地写入权，不发起 Turn，也不加载历史正文。
pub async fn retain_task_writer(
    connection: &AppServerConnection,
    project_id: &str,
    task_id: &str,
) -> Result<(), ConnectionError> {
    let settings = read_agent_runtime_settings(connection).await?;
    ensure_task_writer(connection, project_id, task_id, &settings).await
}

/// 以当前 Provider 状态确认写入权；调用方可复用已读取的偏好，避免重复配置 RPC。
pub async fn ensure_task_writer(
    connection: &AppServerConnection,
    project_id: &str,
    task_id: &str,
    settings: &crate::domain::agent_configuration::AgentRuntimeSettings,
) -> Result<(), ConnectionError> {
    // 已载入的线程也必须 resume，重新建立被 unsubscribe 释放的服务端通知订阅。
    match resume_task(connection, project_id, task_id, settings).await {
        Err(error) if missing_rollout(&error, task_id) || empty_rollout(&error) => {
            if empty_rollout(&error) && !is_new_task(connection, project_id, task_id)? {
                return Err(error);
            }
            // 154 的无 rollout 新线程不能 resume；仅在同一进程确认仍载入时沿用已有写入权。
            let loaded = match is_task_loaded(connection, project_id, task_id).await {
                Ok(loaded) => loaded,
                Err(read_error) if empty_rollout(&read_error) => {
                    new_task_is_loaded(connection, project_id, task_id).await?
                }
                Err(read_error) => return Err(read_error),
            };
            if loaded { Ok(()) } else { Err(error) }
        }
        result => result,
    }
}

fn missing_rollout(error: &ConnectionError, task_id: &str) -> bool {
    matches!(error, ConnectionError::Request { code: -32600, message }
        if message == &format!("no rollout found for thread id {task_id}"))
}

fn empty_rollout(error: &ConnectionError) -> bool {
    matches!(error, ConnectionError::Request { code: -32603, message }
        if message.starts_with("failed to read thread: thread-store internal error: failed to read session metadata ")
            && message.contains("rollout at ") && message.ends_with(" is empty"))
}

async fn new_task_is_loaded(
    connection: &AppServerConnection,
    project_id: &str,
    task_id: &str,
) -> Result<bool, ConnectionError> {
    // 只信任当前连接创建且尚未释放订阅的新线程；loaded/list 不读取 rollout。
    if !is_new_task(connection, project_id, task_id)? {
        return Ok(false);
    }
    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct LoadedPage {
        data: Vec<String>,
        next_cursor: Option<String>,
    }
    let mut cursor: Option<String> = None;
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(5);
    for _ in 0..32 {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            return Ok(false);
        }
        let page: LoadedPage = connection
            .request(
                "thread/loaded/list",
                &serde_json::json!({"cursor": cursor, "limit": 128}),
                remaining,
            )
            .await?;
        if page.data.iter().any(|id| id == task_id) {
            return is_new_task(connection, project_id, task_id);
        }
        if page.next_cursor.is_none() || page.next_cursor == cursor {
            return Ok(false);
        }
        cursor = page.next_cursor;
    }
    Ok(false)
}

fn is_new_task(
    connection: &AppServerConnection,
    project_id: &str,
    task_id: &str,
) -> Result<bool, ConnectionError> {
    Ok(connection
        .new_task_projects
        .lock()
        .map_err(|_| ConnectionError::StateUnavailable)?
        .get(task_id)
        .is_some_and(|project| project == project_id))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, duplex, split};

    async fn empty_rollout_retain(project: Option<&str>, loaded: bool) -> bool {
        let (client, server) = duplex(8192);
        let (reader, writer) = split(client);
        let connection = AppServerConnection::new(reader, writer);
        if let Some(project) = project {
            connection
                .new_task_projects
                .lock()
                .unwrap()
                .insert("thread-a".into(), project.into());
        }
        let confirm_loaded = project == Some("project-a");
        let (reader, mut writer) = split(server);
        let peer = tokio::spawn(async move {
            let mut lines = BufReader::new(reader).lines();
            let mut methods = vec!["config/read", "thread/resume"];
            if confirm_loaded {
                methods.extend(["thread/read", "thread/loaded/list"]);
            }
            for method in methods {
                let request: Value =
                    serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
                assert_eq!(request["method"], method);
                let response = match method {
                    "config/read" => json!({"result": {"config": {}}}),
                    "thread/loaded/list" => {
                        assert_eq!(request["params"]["limit"], 128);
                        json!({"result": {"data": if loaded { vec!["thread-a"] } else { vec!["other-thread"] }, "nextCursor": null}})
                    }
                    _ => {
                        json!({"error": {"code": -32603, "message": "failed to read thread: thread-store internal error: failed to read session metadata from 中文目录: rollout at 中文目录/rollout-thread-a.jsonl is empty"}})
                    }
                };
                let mut response = response;
                response["id"] = request["id"].clone();
                writer
                    .write_all(format!("{response}\n").as_bytes())
                    .await
                    .unwrap();
            }
            assert!(
                lines.next_line().await.unwrap().is_none(),
                "unexpected RPC after writer check"
            );
        });
        let result = retain_task_writer(&connection, "project-a", "thread-a")
            .await
            .is_ok();
        drop(connection);
        peer.await.unwrap();
        result
    }

    #[tokio::test]
    async fn empty_rollout_should_reuse_only_a_loaded_new_task_from_this_project() {
        assert!(empty_rollout_retain(Some("project-a"), true).await);
        assert!(!empty_rollout_retain(Some("project-a"), false).await);
        assert!(!empty_rollout_retain(Some("other-project"), true).await);
        assert!(!empty_rollout_retain(None, true).await);
    }

    #[test]
    fn empty_rollout_match_should_reject_other_storage_failures() {
        for (code, message) in [
            (-32603, "failed to read thread: permission denied"),
            (
                -32603,
                "failed to read thread: thread-store internal error: failed to read session metadata from path: rollout at path is corrupt",
            ),
            (
                -32600,
                "failed to read thread: thread-store internal error: failed to read session metadata from path: rollout at path is empty",
            ),
            (-32600, "thread thread-a already has an active writer"),
        ] {
            assert!(!empty_rollout(&ConnectionError::Request {
                code,
                message: message.into()
            }));
        }
    }

    #[tokio::test]
    async fn loaded_confirmation_should_page_and_recheck_creation_evidence() {
        for revoked in [false, true] {
            let (client, server) = duplex(8192);
            let (reader, writer) = split(client);
            let connection = std::sync::Arc::new(AppServerConnection::new(reader, writer));
            connection
                .new_task_projects
                .lock()
                .unwrap()
                .insert("thread-a".into(), "project-a".into());
            let weak = std::sync::Arc::downgrade(&connection);
            let (reader, mut writer) = split(server);
            let peer = tokio::spawn(async move {
                let mut lines = BufReader::new(reader).lines();
                for (cursor, result) in [
                    (
                        Value::Null,
                        json!({"data": ["other-thread"], "nextCursor": "next"}),
                    ),
                    (
                        json!("next"),
                        json!({"data": ["thread-a"], "nextCursor": null}),
                    ),
                ] {
                    let request: Value =
                        serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
                    assert_eq!(request["method"], "thread/loaded/list");
                    assert_eq!(request["params"]["cursor"], cursor);
                    if revoked && !cursor.is_null() {
                        weak.upgrade()
                            .unwrap()
                            .new_task_projects
                            .lock()
                            .unwrap()
                            .remove("thread-a");
                    }
                    writer
                        .write_all(
                            format!("{}\n", json!({"id": request["id"], "result": result}))
                                .as_bytes(),
                        )
                        .await
                        .unwrap();
                }
                assert!(lines.next_line().await.unwrap().is_none());
            });
            assert_eq!(
                new_task_is_loaded(&connection, "project-a", "thread-a")
                    .await
                    .unwrap(),
                !revoked
            );
            drop(connection);
            peer.await.unwrap();
        }
    }

    #[tokio::test]
    async fn retaining_a_loaded_thread_should_restore_its_server_subscription() {
        let (client, server) = duplex(8192);
        let (reader, writer) = split(client);
        let connection = AppServerConnection::new(reader, writer);
        let (reader, mut writer) = split(server);
        let peer = tokio::spawn(async move {
            let mut lines = BufReader::new(reader).lines();
            for (method, result) in [
                ("config/read", json!({"config": {}})),
                (
                    "thread/resume",
                    json!({"thread": {"id": "thread-a", "projectId": "project-a"}}),
                ),
            ] {
                let request: Value =
                    serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
                assert_eq!(request["method"], method);
                if method == "thread/resume" {
                    assert_eq!(request["params"]["excludeTurns"], true);
                    assert!(request["params"].get("cwd").is_none());
                }
                writer
                    .write_all(
                        format!("{}\n", json!({"id": request["id"], "result": result})).as_bytes(),
                    )
                    .await
                    .unwrap();
            }
        });
        retain_task_writer(&connection, "project-a", "thread-a")
            .await
            .unwrap();
        peer.await.unwrap();
    }
}
