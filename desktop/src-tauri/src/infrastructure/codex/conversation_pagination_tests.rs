use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, duplex, split};

use super::{ConnectionError, NativeTurn, hydrate_paginated_turn, validate_page_cursors};
use crate::infrastructure::codex::AppServerConnection;

#[tokio::test]
async fn item_continuation_should_finish_current_turn_before_loading_older_turns() {
    let (client, server) = duplex(16 * 1024);
    let (client_reader, client_writer) = split(client);
    let (server_reader, mut server_writer) = split(server);
    let connection = AppServerConnection::new(client_reader, client_writer);
    let server_task = tokio::spawn(async move {
        let mut lines = BufReader::new(server_reader).lines();
        for (method, result) in [
            (
                "thread/turns/list",
                json!({"data": [{"id": "turn-a", "status": "completed", "startedAt": 1, "completedAt": 2, "error": null}], "nextCursor": "older-turns"}),
            ),
            (
                "thread/items/list",
                json!({"data": [{"turnId": "turn-a", "item": {"id": "new", "type": "plan", "text": "new"}}], "nextCursor": "older-items"}),
            ),
            (
                "thread/items/list",
                json!({"data": [{"turnId": "turn-a", "startedAtMs": 1000, "item": {"id": "old", "type": "plan", "text": "old"}}], "nextCursor": null}),
            ),
            ("thread/turns/list", json!({"data": [], "nextCursor": null})),
        ] {
            let request: Value =
                serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
            assert_eq!(request["method"], method);
            if result["data"][0]["item"]["id"] == "old" {
                assert_eq!(request["params"]["cursor"], "older-items");
            }
            if result["data"] == json!([]) {
                assert_eq!(request["params"]["cursor"], "older-turns");
            }
            server_writer
                .write_all(
                    format!("{}\n", json!({"id": request["id"], "result": result})).as_bytes(),
                )
                .await
                .unwrap();
        }
    });
    let mode = super::NativeThreadHistoryMode::Paginated;
    let (first, cursor) = super::read_turn_page(&connection, "thread-a", mode, None)
        .await
        .unwrap();
    assert_eq!(first[0].items[0]["id"], "new");
    let (second, next) = super::read_turn_page(&connection, "thread-a", mode, cursor.as_deref())
        .await
        .unwrap();
    assert_eq!(second[0].items[0]["id"], "old");
    assert_eq!(
        second[0].item_timings.as_ref().unwrap()["old"].started_at_ms,
        Some(1000)
    );
    assert_eq!(next.as_deref(), Some("older-turns"));
    let (last, next) = super::read_turn_page(&connection, "thread-a", mode, next.as_deref())
        .await
        .unwrap();
    assert!(last.is_empty());
    assert!(next.is_none());
    server_task.await.unwrap();
}

#[test]
fn page_cursors_should_be_non_empty_and_advance() {
    assert!(validate_page_cursors(None, Some("next"), Some("back")).is_ok());
    assert!(matches!(
        validate_page_cursors(Some("same"), Some("same"), None),
        Err(ConnectionError::InvalidMessage)
    ));
    assert!(matches!(
        validate_page_cursors(None, None, Some("")),
        Err(ConnectionError::InvalidMessage)
    ));
}

#[tokio::test]
async fn paginated_items_should_belong_to_requested_turn() {
    let (client, server) = duplex(8 * 1024);
    let (client_reader, client_writer) = split(client);
    let (server_reader, mut server_writer) = split(server);
    let connection = AppServerConnection::new(client_reader, client_writer);
    let server_task = tokio::spawn(async move {
        let mut lines = BufReader::new(server_reader).lines();
        let request: Value =
            serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
        assert_eq!(request["method"], "thread/items/list");
        server_writer
            .write_all(
                format!(
                    "{}\n",
                    json!({
                        "id": request["id"].clone(),
                        "result": {
                            "data": [{"turnId": "turn-b", "item": {"id": "item-a", "type": "plan", "text": "x"}}],
                            "nextCursor": null,
                            "backwardsCursor": null
                        }
                    })
                )
                .as_bytes(),
            )
            .await
            .unwrap();
    });
    let turn = NativeTurn {
        completed_at: None,
        error: None,
        id: "turn-a".to_owned(),
        item_timings: None,
        items: Vec::new(),
        started_at: None,
        status: "completed".to_owned(),
    };

    assert!(matches!(
        hydrate_paginated_turn(&connection, "thread-a", turn).await,
        Err(ConnectionError::InvalidMessage)
    ));
    server_task.await.unwrap();
}
