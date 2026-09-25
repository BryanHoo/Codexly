use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, duplex, split};

use super::{AppServerConnection, conversation::read_task_snapshot};

#[tokio::test]
async fn live_reviewer_should_only_patch_exact_target_and_preserve_outcomes() {
    for status in ["applied", "targetUnavailable"] {
        let (client, server) = duplex(8 * 1024);
        let (reader, writer) = split(client);
        let (server_reader, mut server_writer) = split(server);
        let connection = AppServerConnection::new(reader, writer);
        let server_task = tokio::spawn(async move {
            let mut lines = BufReader::new(server_reader).lines();
            let request: Value =
                serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
            assert_eq!(request["method"], "turn/settings/update");
            assert_eq!(
                request["params"],
                json!({
                    "threadId": "thread-a", "turnId": "turn-a", "approvalsReviewer": "auto_review"
                })
            );
            server_writer
                .write_all(
                    format!(
                        "{}\n",
                        json!({
                            "id": request["id"], "result": {"status": status}
                        })
                    )
                    .as_bytes(),
                )
                .await
                .unwrap();
        });
        let result = super::update_live_reviewer(&connection, "thread-a", "turn-a", "auto_review")
            .await
            .unwrap();
        assert_eq!(serde_json::to_value(result).unwrap(), status);
        server_task.await.unwrap();
    }
}

#[tokio::test]
async fn live_reviewer_should_propagate_managed_policy_rejection() {
    let (client, server) = duplex(8 * 1024);
    let (reader, writer) = split(client);
    let (server_reader, mut server_writer) = split(server);
    let connection = AppServerConnection::new(reader, writer);
    let server_task = tokio::spawn(async move {
        let mut lines = BufReader::new(server_reader).lines();
        let request: Value =
            serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
        server_writer.write_all(format!("{}\n", json!({
            "id": request["id"], "error": {"code": -32602, "message": "Reviewer is required by managed policy"}
        })).as_bytes()).await.unwrap();
    });
    let result = super::update_live_reviewer(&connection, "thread-a", "turn-a", "user").await;
    assert!(matches!(
        result,
        Err(super::connection::ConnectionError::Request { code: -32602, .. })
    ));
    server_task.await.unwrap();
}

#[tokio::test]
async fn snapshot_should_include_thread_configuration_without_additional_requests() {
    for (model, effort) in [
        (json!("gpt-6-astra"), json!("high")),
        (Value::Null, Value::Null),
    ] {
        let expected = json!({"model": model, "reasoningEffort": effort});
        let (client, server) = duplex(8 * 1024);
        let (reader, writer) = split(client);
        let (server_reader, mut server_writer) = split(server);
        let connection = AppServerConnection::new(reader, writer);
        let server_task = tokio::spawn(async move {
            let mut lines = BufReader::new(server_reader).lines();
            for (method, result) in [
                (
                    "thread/read",
                    json!({"thread": {
                        "id": "thread-a", "name": "任务", "preview": "", "projectId": "project-a",
                        "historyMode": "paginated", "section": null, "updatedAt": 1735689600,
                        "status": {"type": "idle"}, "model": model, "reasoningEffort": effort
                    }}),
                ),
                ("thread/turns/list", json!({"data": [], "nextCursor": null})),
                ("thread/goal/get", json!({"goal": null})),
            ] {
                let request: Value =
                    serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
                assert_eq!(request["method"], method);
                server_writer
                    .write_all(
                        format!("{}\n", json!({"id": request["id"], "result": result})).as_bytes(),
                    )
                    .await
                    .unwrap();
            }
        });
        let response = read_task_snapshot(&connection, "project-a".into(), "thread-a".into(), None)
            .await
            .unwrap();
        let snapshot = serde_json::to_value(response.snapshot).unwrap();
        assert_eq!(snapshot["threadConfiguration"], expected);
        server_task.await.unwrap();
    }
}
