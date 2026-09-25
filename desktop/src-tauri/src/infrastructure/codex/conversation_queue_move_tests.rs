use std::sync::{Arc, Mutex};

use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, duplex, split};

use super::*;

fn queue_server(
    pages: Vec<Value>,
) -> (
    AppServerConnection,
    Arc<Mutex<Vec<Value>>>,
    tokio::task::JoinHandle<()>,
) {
    let (client, server) = duplex(32 * 1024);
    let (reader, writer) = split(client);
    let (server_reader, mut server_writer) = split(server);
    let requests = Arc::new(Mutex::new(Vec::new()));
    let captured = Arc::clone(&requests);
    let task = tokio::spawn(async move {
        let mut pages = pages.into_iter();
        let mut lines = BufReader::new(server_reader).lines();
        while let Some(line) = lines.next_line().await.unwrap() {
            let request: Value = serde_json::from_str(&line).unwrap();
            captured.lock().unwrap().push(request.clone());
            let result = match request["method"].as_str().unwrap() {
                "thread/queue/list" => pages.next().expect("unexpected page read"),
                "thread/queue/reorder" => pages.next().unwrap_or_else(|| json!({})),
                method => panic!("unexpected method: {method}"),
            };
            let response = if result.get("error").is_some() {
                json!({"id":request["id"],"error":result["error"]})
            } else {
                json!({"id":request["id"],"result":result})
            };
            server_writer
                .write_all(format!("{response}\n").as_bytes())
                .await
                .unwrap();
        }
    });
    (AppServerConnection::new(reader, writer), requests, task)
}

#[tokio::test]
async fn native_queue_move_should_use_current_order_across_pages() {
    let (connection, requests, server) = queue_server(vec![
        json!({"data":[{"id":"new"},{"id":"a"}],"nextCursor":"next"}),
        json!({"data":[{"id":"b"},{"id":"c"}],"nextCursor":null}),
    ]);
    let moved = move_queued_submission(&connection, "thread-a", "b", -1)
        .await
        .unwrap();
    assert!(moved);
    let requests = requests.lock().unwrap();
    assert_eq!(requests.len(), 3);
    assert_eq!(
        requests[0]["params"],
        json!({"threadId":"thread-a","cursor":null,"limit":100})
    );
    assert_eq!(requests[1]["params"]["cursor"], "next");
    assert_eq!(
        requests[2]["params"],
        json!({"threadId":"thread-a","queuedSubmissionIds":["new","b","a","c"]})
    );
    server.abort();
}

#[tokio::test]
async fn native_queue_move_should_skip_missing_and_boundary_items_without_writing() {
    for (id, offset) in [("a", -1), ("b", 1), ("deleted", 1)] {
        let (connection, requests, server) = queue_server(vec![
            json!({"data":[{"id":"a"},{"id":"b"}],"nextCursor":null}),
        ]);
        assert!(
            !move_queued_submission(&connection, "thread-a", id, offset)
                .await
                .unwrap()
        );
        assert_eq!(requests.lock().unwrap().len(), 1);
        server.abort();
    }
}

#[tokio::test]
async fn native_queue_move_should_reject_invalid_intents_before_rpc() {
    for (id, offset) in [
        ("a", 0),
        ("a", 2),
        ("", 1),
        (&"x".repeat(MAX_FIELD_BYTES + 1), 1),
    ] {
        let (connection, requests, server) = queue_server(vec![]);
        assert!(matches!(
            move_queued_submission(&connection, "thread-a", id, offset).await,
            Err(ConnectionError::InvalidMessage)
        ));
        assert!(requests.lock().unwrap().is_empty());
        server.abort();
    }
}

#[tokio::test]
async fn native_queue_move_should_reject_duplicate_ids_and_cursors_without_writing() {
    for pages in [
        vec![json!({"data":[{"id":"a"},{"id":"a"}],"nextCursor":null})],
        vec![json!({"data":[{"id":"a"}],"nextCursor":""})],
        vec![
            json!({"data":[{"id":"a"}],"nextCursor":"same"}),
            json!({"data":[{"id":"b"}],"nextCursor":"same"}),
        ],
        vec![
            json!({"data":[{"id":"a"}],"nextCursor":"next"}),
            json!({"data":[{"id":"a"}],"nextCursor":null}),
        ],
    ] {
        let count = pages.len();
        let (connection, requests, server) = queue_server(pages);
        assert!(matches!(
            move_queued_submission(&connection, "thread-a", "a", 1).await,
            Err(ConnectionError::InvalidMessage)
        ));
        assert_eq!(requests.lock().unwrap().len(), count);
        server.abort();
    }
}

#[tokio::test]
async fn native_queue_move_should_bound_pages_and_identity_bytes() {
    let large_ids: Vec<Value> = (0..PAGE_LIMIT)
        .map(|index| json!({"id":format!("{index}:{}", "x".repeat(3000))}))
        .collect();
    for pages in [
        vec![json!({"data":large_ids,"nextCursor":null})],
        (0..MAX_PAGES)
            .map(|index| json!({"data":[],"nextCursor":index.to_string()}))
            .collect(),
        vec![json!({"data":vec![json!({"id":"a"}); PAGE_LIMIT + 1],"nextCursor":null})],
        vec![json!({"data":[{"id":""}],"nextCursor":null})],
        vec![json!({"data":[{"id":"x".repeat(MAX_FIELD_BYTES+1)}],"nextCursor":null})],
        vec![json!({"data":[],"nextCursor":"x".repeat(MAX_FIELD_BYTES+1)})],
    ] {
        let count = pages.len();
        let (connection, requests, server) = queue_server(pages);
        assert!(matches!(
            move_queued_submission(&connection, "thread-a", "a", 1).await,
            Err(ConnectionError::InvalidMessage)
        ));
        assert_eq!(requests.lock().unwrap().len(), count);
        server.abort();
    }
}

#[tokio::test]
async fn native_queue_move_should_propagate_failures_without_retrying_writes() {
    for pages in [
        vec![json!({"error":{"code":-32602,"message":"queue changed"}})],
        vec![
            json!({"data":[{"id":"a"},{"id":"b"}],"nextCursor":null}),
            json!({"error":{"code":-32602,"message":"queue changed"}}),
        ],
    ] {
        let count = pages.len();
        let (connection, requests, server) = queue_server(pages);
        let result = move_queued_submission(&connection, "thread-a", "a", 1).await;
        assert!(matches!(
            result,
            Err(ConnectionError::Request { code: -32602, .. })
        ));
        assert_eq!(requests.lock().unwrap().len(), count);
        server.abort();
    }
}

#[tokio::test]
async fn native_queue_move_should_skip_content_mapping_when_moving_down() {
    let (connection, requests, server) = queue_server(vec![json!({"data":[
        {"id":"a","input":[{"type":"futureProviderInput","data":"正文"}],"clientUserMessageId":"client-a"},
        {"id":"b"}
    ],"nextCursor":null})]);
    assert!(
        move_queued_submission(&connection, "thread-a", "a", 1)
            .await
            .unwrap()
    );
    assert_eq!(
        requests.lock().unwrap()[1]["params"]["queuedSubmissionIds"],
        json!(["b", "a"])
    );
    server.abort();
}
