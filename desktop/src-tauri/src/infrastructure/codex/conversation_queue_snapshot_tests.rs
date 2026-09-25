use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, duplex, split};

use super::*;

fn submission(id: &str) -> Value {
    json!({"id":id,"clientUserMessageId":format!("client-{id}"),"input":[{"type":"text","text":format!("text-{id}")} ]})
}

fn server(pages: Vec<Value>) -> (AppServerConnection, tokio::task::JoinHandle<()>) {
    let (client, server) = duplex(32 * 1024);
    let (reader, writer) = split(client);
    let (server_reader, mut server_writer) = split(server);
    let handle = tokio::spawn(async move {
        let mut lines = BufReader::new(server_reader).lines();
        let mut cursor = Value::Null;
        for page in pages {
            let request: Value =
                serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
            assert_eq!(request["method"], "thread/queue/list");
            assert_eq!(
                request["params"],
                json!({"threadId":"task","cursor":cursor,"limit":100})
            );
            cursor = page["nextCursor"].clone();
            let response = if page.get("error").is_some() {
                json!({"id":request["id"],"error":page["error"]})
            } else {
                json!({"id":request["id"],"result":page})
            };
            server_writer
                .write_all(format!("{response}\n").as_bytes())
                .await
                .unwrap();
        }
    });
    (AppServerConnection::new(reader, writer), handle)
}

#[tokio::test]
async fn queue_snapshot_should_return_all_pages_without_webview_pagination() {
    let (connection, handle) = server(vec![
        json!({"data":[submission("a")],"nextCursor":"next"}),
        json!({"data":[submission("b")],"nextCursor":null}),
    ]);
    let snapshot = read_queued_submissions(&connection, "task").await.unwrap();
    assert_eq!(
        snapshot
            .data
            .iter()
            .map(|item| item.id.as_str())
            .collect::<Vec<_>>(),
        ["a", "b"]
    );
    assert_eq!(snapshot.data[1].text, "text-b");
    assert_eq!(snapshot.data[1].status, "queued");
    assert!(
        serde_json::to_value(snapshot)
            .unwrap()
            .get("nextCursor")
            .is_none()
    );
    handle.await.unwrap();
}

#[tokio::test]
async fn queue_snapshot_should_reject_bad_pagination_and_duplicate_identity() {
    for pages in [
        vec![json!({"data":[],"nextCursor":""})],
        vec![json!({"data":[],"nextCursor":"x".repeat(MAX_CURSOR_BYTES+1)})],
        vec![
            json!({"data":[submission("a")],"nextCursor":"same"}),
            json!({"data":[submission("b")],"nextCursor":"same"}),
        ],
        vec![
            json!({"data":[submission("a")],"nextCursor":"next"}),
            json!({"data":[submission("a")],"nextCursor":null}),
        ],
        vec![json!({"data":vec![submission("a");101],"nextCursor":null})],
        (0..MAX_PAGES)
            .map(|index| json!({"data":[],"nextCursor":index.to_string()}))
            .collect(),
    ] {
        let (connection, handle) = server(pages);
        assert!(matches!(
            read_queued_submissions(&connection, "task").await,
            Err(ConnectionError::InvalidMessage)
        ));
        handle.await.unwrap();
    }
}

#[tokio::test]
async fn queue_snapshot_should_count_escaped_content_and_aggregate_bytes() {
    let mut escaped = submission("escaped");
    escaped["input"][0]["text"] = json!("\n".repeat(MAX_BYTES / 2));
    let mut a = submission("a");
    a["input"][0]["text"] = json!("x".repeat(MAX_BYTES / 2));
    let mut b = submission("b");
    b["input"][0]["text"] = json!("x".repeat(MAX_BYTES / 2));
    for pages in [
        vec![json!({"data":[escaped],"nextCursor":null})],
        vec![
            json!({"data":[a],"nextCursor":"next"}),
            json!({"data":[b],"nextCursor":null}),
        ],
    ] {
        let (connection, handle) = server(pages);
        assert!(matches!(
            read_queued_submissions(&connection, "task").await,
            Err(ConnectionError::InvalidMessage)
        ));
        handle.await.unwrap();
    }
}

#[tokio::test]
async fn queue_snapshot_should_discard_partial_results_on_page_failure() {
    let (connection, handle) = server(vec![
        json!({"data":[submission("a")],"nextCursor":"next"}),
        json!({"error":{"code":-32602,"message":"queue unavailable"}}),
    ]);
    assert!(matches!(
        read_queued_submissions(&connection, "task").await,
        Err(ConnectionError::Request { code: -32602, .. })
    ));
    handle.await.unwrap();
}

#[tokio::test]
async fn queue_snapshot_should_return_an_empty_complete_snapshot() {
    let (connection, handle) = server(vec![json!({"data":[],"nextCursor":null})]);
    assert_eq!(
        serde_json::to_value(read_queued_submissions(&connection, "task").await.unwrap()).unwrap(),
        json!({"data":[]})
    );
    handle.await.unwrap();
}
