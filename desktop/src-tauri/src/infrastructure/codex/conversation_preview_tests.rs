use super::*;
use serde_json::json;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, duplex, split};

#[tokio::test]
async fn task_window_preview_reads_only_one_turn_and_one_bounded_item_page() {
    let (client, server) = duplex(16 * 1024);
    let (reader, writer) = split(client);
    let (server_reader, mut server_writer) = split(server);
    let connection = AppServerConnection::new(reader, writer);
    let server_task = tokio::spawn(async move {
        let mut lines = BufReader::new(server_reader).lines();
        for (method, result) in [
            (
                "thread/read",
                json!({"thread": {"id":"task-a", "projectId":"project-a", "name":"Task A", "preview":"", "historyMode":"paginated", "status":{"type":"active"}, "updatedAt":0}}),
            ),
            (
                "thread/turns/list",
                json!({"data":[{"id":"turn-a", "status":"inProgress", "items":[]}], "nextCursor":"older-turns"}),
            ),
            (
                "thread/items/list",
                json!({"data":[{"turnId":"turn-a", "item":{"id":"item-a", "type":"agentMessage", "text":"hello"}}], "nextCursor":"older-items"}),
            ),
        ] {
            let request: Value =
                serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
            assert_eq!(request["method"], method);
            if method == "thread/turns/list" {
                assert_eq!(request["params"]["limit"], 1);
                assert_eq!(request["params"]["itemsView"], "notLoaded");
            }
            if method == "thread/items/list" {
                assert_eq!(request["params"]["limit"], 12);
            }
            server_writer
                .write_all(format!("{}\n", json!({"id":request["id"], "result":result})).as_bytes())
                .await
                .unwrap();
        }
    });
    let (title, status, items) = read_task_preview(&connection, "project-a", "task-a")
        .await
        .unwrap();
    assert_eq!(title, "Task A");
    assert_eq!(status, "running");
    assert_eq!(items.len(), 1);
    server_task.await.unwrap();
}

#[tokio::test]
async fn read_task_summary_should_request_goal_and_history_concurrently() {
    let (client, server) = duplex(32 * 1024);
    let (client_reader, client_writer) = split(client);
    let (server_reader, mut writer) = split(server);
    let connection = AppServerConnection::new(client_reader, client_writer);
    let server_task = tokio::spawn(async move {
        let mut lines = BufReader::new(server_reader).lines();
        let request: Value =
            serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
        writer.write_all(format!("{}\n", json!({"id": request["id"], "result": {"thread": {
            "id": "thread-a", "name": "历史", "preview": "", "projectId": "project-a",
            "historyMode": "paginated", "updatedAt": 1735689600, "status": {"type": "idle"}
        }}})).as_bytes()).await.unwrap();
        // 两个读取都必须在任一响应返回前发出，消除固定的串行往返。
        let first: Value =
            serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
        let second =
            tokio::time::timeout(std::time::Duration::from_millis(500), lines.next_line()).await;
        assert!(second.is_ok(), "历史与 Goal 读取不能相互等待");
        let second: Value = serde_json::from_str(&second.unwrap().unwrap().unwrap()).unwrap();
        assert_ne!(first["method"], second["method"]);
        for request in [first, second] {
            let result = match request["method"].as_str().unwrap() {
                "thread/turns/list" => json!({"data": [], "nextCursor": null}),
                "thread/goal/get" => json!({"goal": null}),
                other => panic!("unexpected request: {other}"),
            };
            writer
                .write_all(
                    format!("{}\n", json!({"id": request["id"], "result": result})).as_bytes(),
                )
                .await
                .unwrap();
        }
    });
    let snapshot =
        read_task_summary_snapshot(&connection, "project-a".into(), "thread-a".into(), None).await;
    server_task.await.unwrap();
    assert!(snapshot.is_ok());
}
