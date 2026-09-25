use super::{AppServerConnection, connection::ConnectionError, start_turn};
use crate::domain::conversation::{AgentPromptInput, AgentTurnOptions};
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, duplex, split};

// 模拟 Provider 的恢复与元数据应答；所有用例都要求失败前不发送 turn/start。
async fn rejected_start(resume_error: Value, thread: Option<Value>) -> ConnectionError {
    rejected_start_with_project(resume_error, thread, None).await
}

async fn rejected_start_with_project(
    resume_error: Value,
    thread: Option<Value>,
    created_project: Option<&str>,
) -> ConnectionError {
    let (client, server) = duplex(8192);
    let (reader, writer) = split(client);
    let connection = AppServerConnection::new(reader, writer);
    if let Some(project) = created_project {
        connection
            .new_task_projects
            .lock()
            .unwrap()
            .insert("thread-a".into(), project.into());
    }
    let (reader, mut writer) = split(server);
    let peer = tokio::spawn(async move {
        let mut lines = BufReader::new(reader).lines();
        let request: Value =
            serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
        assert_eq!(request["method"], "thread/resume");
        writer
            .write_all(
                format!("{}\n", json!({"id": request["id"], "error": resume_error})).as_bytes(),
            )
            .await
            .unwrap();
        if let Some(thread) = thread {
            let request: Value =
                serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
            assert_eq!(request["method"], "thread/read");
            assert_eq!(
                request["params"],
                json!({"threadId": "thread-a", "includeTurns": false})
            );
            writer
                .write_all(
                    format!(
                        "{}\n",
                        json!({"id": request["id"], "result": {"thread": thread}})
                    )
                    .as_bytes(),
                )
                .await
                .unwrap();
        }
        // 调用完成后由测试关闭连接；若额外执行 Turn，立即让断言失败。
        assert!(
            lines.next_line().await.unwrap().is_none(),
            "must not start a turn after readiness failure"
        );
    });
    let error = start_turn(
        &connection,
        "project-a".into(),
        "thread-a".into(),
        AgentPromptInput::text("must not execute"),
        AgentTurnOptions::default(),
        &Default::default(),
    )
    .await
    .unwrap_err();
    drop(connection);
    peer.await.unwrap();
    error
}

fn missing_rollout() -> Value {
    json!({"code": -32600, "message": "no rollout found for thread id thread-a"})
}

fn thread(id: &str, project_id: &str, status: &str) -> Value {
    json!({"id": id, "name": null, "preview": "", "projectId": project_id,
        "section": null, "status": {"type": status}, "updatedAt": 1735689600})
}

#[tokio::test]
async fn turn_readiness_should_reject_missing_project_without_creation_evidence() {
    let mut snapshot = thread("thread-a", "project-a", "idle");
    snapshot["projectId"] = Value::Null;
    let error = rejected_start(missing_rollout(), Some(snapshot)).await;
    assert!(matches!(error, ConnectionError::InvalidMessage));
}

#[tokio::test]
async fn turn_readiness_should_reject_missing_project_created_for_another_project() {
    let mut snapshot = thread("thread-a", "project-a", "idle");
    snapshot["projectId"] = Value::Null;
    let error =
        rejected_start_with_project(missing_rollout(), Some(snapshot), Some("other-project")).await;
    assert!(matches!(error, ConnectionError::InvalidMessage));
}

#[tokio::test]
async fn turn_readiness_should_not_override_native_project_with_creation_evidence() {
    let error = rejected_start_with_project(
        missing_rollout(),
        Some(thread("thread-a", "other-project", "idle")),
        Some("project-a"),
    )
    .await;
    assert!(matches!(error, ConnectionError::InvalidMessage));
}

#[tokio::test]
async fn turn_readiness_should_preserve_missing_rollout_for_unloaded_thread() {
    let error = rejected_start(
        missing_rollout(),
        Some(thread("thread-a", "project-a", "notLoaded")),
    )
    .await;
    assert!(
        matches!(error, ConnectionError::Request { code: -32600, message } if message == "no rollout found for thread id thread-a")
    );
}

#[tokio::test]
async fn turn_readiness_should_reject_cross_project_loaded_thread() {
    let error = rejected_start(
        missing_rollout(),
        Some(thread("thread-a", "other-project", "idle")),
    )
    .await;
    assert!(matches!(error, ConnectionError::InvalidMessage));
}

#[tokio::test]
async fn turn_readiness_should_reject_mismatched_loaded_thread_identity() {
    let error = rejected_start(
        missing_rollout(),
        Some(thread("other-thread", "project-a", "idle")),
    )
    .await;
    assert!(matches!(error, ConnectionError::InvalidMessage));
}

#[tokio::test]
async fn turn_readiness_should_preserve_other_resume_errors_without_fallback() {
    let error = rejected_start(
        json!({"code": -32600, "message": "thread thread-a already has an active writer"}),
        None,
    )
    .await;
    assert!(matches!(
        crate::application::error::AppError::from(error),
        crate::application::error::AppError::CodexThreadBusy
    ));
}

#[tokio::test]
async fn turn_readiness_should_not_accept_missing_rollout_for_another_thread() {
    let error = rejected_start(
        json!({"code": -32600, "message": "no rollout found for thread id other-thread"}),
        None,
    )
    .await;
    assert!(
        matches!(error, ConnectionError::Request { code: -32600, message } if message.ends_with("other-thread"))
    );
}
