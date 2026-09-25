use serde_json::{Value, json, value::to_raw_value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, duplex, split};

use super::{
    AppServerConnection,
    connection::ServerMessage,
    conversation_requests::{map_server_request, response_for_resolution},
    list_mcp_servers,
};

#[test]
fn user_verification_should_allow_cancellation_without_exposing_the_challenge() {
    let mapped = map_server_request(
        ServerMessage {
            id: Some(154),
            method: "mcpServer/elicitation/request".into(),
            params: to_raw_value(&json!({
                "threadId": "thread-a", "turnId": null, "serverName": "secure",
                "mode": "openai/userVerification", "title": "验证身份",
                "description": "请在受支持的客户端验证身份", "challenge": "private-challenge"
            }))
            .unwrap(),
        },
        1,
        "2026-09-11T00:00:00Z",
    )
    .unwrap()
    .unwrap();
    assert_eq!(mapped.pending.request["mode"], "unsupported");
    assert_eq!(
        mapped.pending.request["message"],
        "请在受支持的客户端验证身份"
    );
    assert!(!mapped.event.to_string().contains("private-challenge"));
    let response = response_for_resolution(&mapped.pending, &json!({"action": "cancel"})).unwrap();
    assert_eq!(response["action"], "cancel");
    assert!(response["content"].is_null());
    assert!(
        response_for_resolution(
            &mapped.pending,
            &json!({
                "action": "accept", "content": {"proof": "forged"}
            })
        )
        .is_err()
    );
}

#[tokio::test]
async fn mcp_discovery_failure_should_not_look_like_a_healthy_empty_catalog() {
    let (client, server) = duplex(16 * 1024);
    let (reader, writer) = split(client);
    let (server_reader, mut server_writer) = split(server);
    let connection = AppServerConnection::new(reader, writer);
    let server_task = tokio::spawn(async move {
        let mut lines = BufReader::new(server_reader).lines();
        let request: Value =
            serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
        assert_eq!(request["method"], "mcpServerStatus/list");
        assert_eq!(request["params"]["detail"], "toolsAndAuthOnly");
        let data: Vec<_> = [
            (
                "broken",
                json!("connected"),
                json!("private discovery failure"),
                "oAuth",
            ),
            ("empty", json!("connected"), Value::Null, "oAuth"),
            (
                "login",
                json!("authenticationRequired"),
                json!("expired"),
                "notLoggedIn",
            ),
            ("disabled", json!("disabled"), json!("stale"), "unknown"),
            ("unknown", Value::Null, json!("discovery failed"), "unknown"),
        ]
        .into_iter()
        .map(|(name, runtime, error, auth)| {
            json!({
                "name": name, "runtimeStatus": runtime, "toolsError": error,
                "tools": {}, "authStatus": auth, "serverInfo": null
            })
        })
        .collect();
        server_writer
            .write_all(
                format!(
                    "{}\n",
                    json!({
                        "id": request["id"], "result": {"data": data, "nextCursor": null}
                    })
                )
                .as_bytes(),
            )
            .await
            .unwrap();
    });
    let result = list_mcp_servers(&connection, "thread-a").await.unwrap();
    let statuses: Vec<_> = result["data"]
        .as_array()
        .unwrap()
        .iter()
        .map(|server| server["status"].as_str().unwrap())
        .collect();
    assert_eq!(
        statuses,
        [
            "failed",
            "connected",
            "authenticationRequired",
            "disabled",
            "failed"
        ]
    );
    // 错误仅影响摘要状态，不扩展 IPC 字段或传输工具定义和错误正文。
    assert!(
        result["data"]
            .as_array()
            .unwrap()
            .iter()
            .all(|server| server.as_object().unwrap().len() == 4)
    );
    server_task.await.unwrap();
}
