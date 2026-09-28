use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, duplex, split};

use super::{ConnectionError, NativeTurn, hydrate_paginated_turn, validate_page_cursors};
use crate::infrastructure::codex::AppServerConnection;

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
