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
