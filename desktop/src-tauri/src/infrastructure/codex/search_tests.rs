use super::*;
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, duplex, split};

#[tokio::test]
async fn unsupported_occurrences_searches_visible_turn_pages_with_real_anchors() {
    let (client, server) = duplex(8192);
    let (reader, writer) = split(client);
    let connection = AppServerConnection::new(reader, writer);
    let (reader, mut writer) = split(server);
    let worker = tokio::spawn(async move {
        let mut lines = BufReader::new(reader).lines();
        for (method, payload) in [
            (
                "thread/searchOccurrences",
                json!({"error":{"code":-32601,"message":"thread/searchOccurrences is not supported yet"}}),
            ),
            (
                "thread/turns/list",
                json!({"result":{"data":[{"id":"turn-empty","items":[{"id":"tool","type":"commandExecution","aggregatedOutput":"中文"}]}],"backwardsCursor":"empty-anchor","nextCursor":"older"}}),
            ),
            (
                "thread/turns/list",
                json!({"result":{"data":[{"id":"turn-hit","items":[{"id":"commentary","type":"agentMessage","phase":"commentary","text":"中文"},{"id":"user-hit","type":"userMessage","content":[{"type":"text","text":"😀中文 中文"}]}]}],"backwardsCursor":"hit-anchor","nextCursor":null}}),
            ),
        ] {
            let request: Value =
                serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
            assert_eq!(request["method"], method);
            if method == "thread/turns/list" {
                assert_eq!(request["params"]["itemsView"], "full");
                assert_eq!(request["params"]["limit"], 10);
                assert_eq!(request["params"]["sortDirection"], "desc");
            }
            let mut response = payload;
            response["id"] = request["id"].clone();
            writer
                .write_all(format!("{response}\n").as_bytes())
                .await
                .unwrap();
        }
    });
    let page = search_task_occurrences(&connection, "task", "中文", None)
        .await
        .unwrap();
    assert_eq!(page.data.len(), 2);
    assert_eq!(page.data[0].item_id, "user-hit");
    assert_eq!(page.data[0].turn_id, "turn-hit");
    assert_eq!(page.data[0].turn_cursor, "hit-anchor");
    assert_eq!(page.data[0].snippet, "😀中文 中文");
    assert_eq!(page.data[0].snippet_match_range.start, 2);
    assert_eq!(page.data[0].snippet_match_range.end, 4);
    worker.await.unwrap();
}

#[tokio::test]
async fn legacy_occurrences_resume_inside_page_without_repeating_native_request() {
    let (client, server) = duplex(16384);
    let (reader, writer) = split(client);
    let connection = AppServerConnection::new(reader, writer);
    let (reader, mut writer) = split(server);
    let worker = tokio::spawn(async move {
        let mut lines = BufReader::new(reader).lines();
        for index in 0..3 {
            let request: Value =
                serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
            let payload = if index == 0 {
                assert_eq!(request["method"], "thread/searchOccurrences");
                json!({"error":{"code":-32601,"message":"not supported"}})
            } else {
                assert_eq!(request["method"], "thread/turns/list");
                if index == 2 {
                    assert_eq!(request["params"]["cursor"], "inclusive");
                }
                json!({"result":{"data":[{"id":"turn","items":[{"id":"user","type":"userMessage","content":[{"type":"text","text":"😀中文 ".repeat(31)}]}]}],"backwardsCursor":"inclusive","nextCursor":"older"}})
            };
            let mut response = payload;
            response["id"] = request["id"].clone();
            writer
                .write_all(format!("{response}\n").as_bytes())
                .await
                .unwrap();
        }
    });
    let first = search_task_occurrences(&connection, "task", "中文", None)
        .await
        .unwrap();
    assert_eq!(first.data.len(), 30);
    let cursor = first.next_cursor.unwrap();
    // 游标绑定任务和查询，不能被复用于其他线程，也不能退回官方搜索游标。
    assert!(
        search_task_occurrences(&connection, "foreign", "中文", Some(&cursor))
            .await
            .is_err()
    );
    assert!(
        search_task_occurrences(&connection, "task", "其他", Some(&cursor))
            .await
            .is_err()
    );
    let second = search_task_occurrences(&connection, "task", "中文", Some(&cursor))
        .await
        .unwrap();
    assert_eq!(second.data.len(), 1);
    let state: Value = serde_json::from_str(
        second
            .next_cursor
            .unwrap()
            .strip_prefix("codexly-search-v1:")
            .unwrap(),
    )
    .unwrap();
    assert_eq!(state["turnCursor"], "older");
    assert_eq!(state["offset"], 0);
    worker.await.unwrap();
}

#[tokio::test]
async fn legacy_occurrences_reject_repeated_cursors_and_preserve_other_errors() {
    for code in [-32601, -32602] {
        let (client, server) = duplex(8192);
        let (reader, writer) = split(client);
        let connection = AppServerConnection::new(reader, writer);
        let (reader, mut writer) = split(server);
        let worker = tokio::spawn(async move {
            let mut lines = BufReader::new(reader).lines();
            let request: Value =
                serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
            let response =
                json!({"id":request["id"],"error":{"code":code,"message":"native error"}});
            writer
                .write_all(format!("{response}\n").as_bytes())
                .await
                .unwrap();
            if code == -32601 {
                for _ in 0..2 {
                    let request: Value =
                        serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
                    let response = json!({"id":request["id"],"result":{"data":[],"nextCursor":"older","backwardsCursor":null}});
                    writer
                        .write_all(format!("{response}\n").as_bytes())
                        .await
                        .unwrap();
                }
            }
        });
        let error = search_task_occurrences(&connection, "task", "中文", None)
            .await
            .unwrap_err();
        if code == -32601 {
            assert!(matches!(error, ConnectionError::InvalidMessage));
        } else {
            assert!(matches!(
                error,
                ConnectionError::Request { code: -32602, .. }
            ));
        }
        worker.await.unwrap();
    }
}

#[tokio::test]
async fn global_search_rejects_empty_and_oversized_queries_before_rpc() {
    let (client, _server) = duplex(64);
    let (reader, writer) = split(client);
    let connection = AppServerConnection::new(reader, writer);
    for query in [" ".to_owned(), "x".repeat(1025)] {
        assert!(
            search_task_occurrences(&connection, "task", &query, None)
                .await
                .is_err()
        );
    }
}

#[tokio::test]
async fn global_search_occurrences_preserve_inclusive_cursor_and_utf16_range() {
    let (client, server) = duplex(8192);
    let (reader, writer) = split(client);
    let connection = AppServerConnection::new(reader, writer);
    let (reader, mut writer) = split(server);
    let worker = tokio::spawn(async move {
        let mut lines = BufReader::new(reader).lines();
        let request: Value =
            serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
        assert_eq!(request["method"], "thread/searchOccurrences");
        assert_eq!(
            request["params"],
            json!({"threadId":"task","searchTerm":"中文","cursor":"next","limit":30})
        );
        let response = json!({"id":request["id"],"result":{"data":[{"itemId":"item","turnId":"turn","turnCursor":"inclusive","snippet":"😀中文", "snippetMatchRange":{"start":2,"end":4}}],"nextCursor":null}});
        writer
            .write_all(format!("{response}\n").as_bytes())
            .await
            .unwrap();
    });
    let page = search_task_occurrences(&connection, "task", "中文", Some("next"))
        .await
        .unwrap();
    assert_eq!(page.data[0].turn_cursor, "inclusive");
    assert_eq!(page.data[0].snippet_match_range.start, 2);
    assert_eq!(page.data[0].snippet_match_range.end, 4);
    worker.await.unwrap();
}
