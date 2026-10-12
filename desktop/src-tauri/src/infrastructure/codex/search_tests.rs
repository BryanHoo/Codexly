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
async fn global_search_maps_titles_and_history_without_loading_turns() {
    for kind in ["tasks", "history"] {
        let (client, server) = duplex(8192);
        let (reader, writer) = split(client);
        let connection = AppServerConnection::new(reader, writer);
        let (reader, mut writer) = split(server);
        let worker = tokio::spawn(async move {
            let mut lines = BufReader::new(reader).lines();
            let request: Value =
                serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
            assert_eq!(
                request["method"],
                if kind == "tasks" {
                    "thread/list"
                } else {
                    "thread/search"
                }
            );
            let params = &request["params"];
            assert_eq!(params["searchTerm"], "中文");
            assert_eq!(params["limit"], if kind == "history" { 10 } else { 30 });
            assert_eq!(params["archived"], true);
            assert_eq!(params["cursor"], "page-2");
            assert!(params.get("projectId").is_none());
            assert!(params.get("sectionId").is_none());
            let thread = json!({"id":"t", "name":"标题", "preview":"preview", "projectId":null, "status":{"type":"idle"}, "updatedAt":1735689600});
            let entry = if kind == "tasks" {
                thread
            } else {
                json!({"thread":thread,"snippet":"中文历史"})
            };
            let response =
                json!({"id":request["id"],"result":{"data":[entry],"nextCursor":"page-3"}});
            writer
                .write_all(format!("{response}\n").as_bytes())
                .await
                .unwrap();
            if kind == "history" {
                let request: Value =
                    serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
                assert_eq!(request["method"], "thread/searchOccurrences");
                assert_eq!(request["params"]["limit"], 1);
                let response = json!({"id":request["id"],"result":{"data":[{"itemId":"item","turnId":"turn","turnCursor":"inclusive","snippet":"中文历史","snippetMatchRange":{"start":0,"end":2}}],"nextCursor":null}});
                writer
                    .write_all(format!("{response}\n").as_bytes())
                    .await
                    .unwrap();
            }
        });
        let page = search_tasks(
            &connection,
            TaskSearchInput {
                query: " 中文 ".into(),
                archived: true,
                kind: Some(kind.into()),
                cursor: Some("page-2".into()),
            },
        )
        .await
        .unwrap();
        assert_eq!(page.data.len(), 1);
        assert_eq!(page.data[0].task.project_id, "temporary");
        assert_eq!(page.data[0].task.title, "标题");
        assert_eq!(
            page.data[0].snippet,
            if kind == "tasks" { "" } else { "中文历史" }
        );
        assert_eq!(page.next_cursor.as_deref(), Some("page-3"));
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
            search_tasks(
                &connection,
                TaskSearchInput {
                    query,
                    archived: false,
                    kind: None,
                    cursor: None
                }
            )
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

#[tokio::test]
async fn history_search_filters_unlocatable_rollout_hits_and_preserves_pagination() {
    let (client, server) = duplex(8192);
    let (reader, writer) = split(client);
    let connection = AppServerConnection::new(reader, writer);
    let (reader, mut writer) = split(server);
    let worker = tokio::spawn(async move {
        let mut lines = BufReader::new(reader).lines();
        for method in ["thread/search", "thread/searchOccurrences"] {
            let request: Value =
                serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
            assert_eq!(request["method"], method);
            let result = if method == "thread/search" {
                json!({"data":[{"thread":{"id":"t","name":"Task","preview":"","projectId":null,"status":{"type":"idle"},"updatedAt":0},"snippet":"过程消息"}],"nextCursor":"next-page"})
            } else {
                json!({"data":[],"nextCursor":null})
            };
            writer
                .write_all(format!("{}\n", json!({"id":request["id"],"result":result})).as_bytes())
                .await
                .unwrap();
        }
    });
    let page = search_tasks(
        &connection,
        TaskSearchInput {
            query: "消息".into(),
            archived: false,
            kind: Some("history".into()),
            cursor: None,
        },
    )
    .await
    .unwrap();
    assert!(page.data.is_empty());
    assert_eq!(page.next_cursor.as_deref(), Some("next-page"));
    worker.await.unwrap();
}

#[tokio::test]
async fn history_search_limits_anchor_requests_to_one_small_page() {
    let (client, server) = duplex(16384);
    let (reader, writer) = split(client);
    let connection = AppServerConnection::new(reader, writer);
    let (reader, mut writer) = split(server);
    let worker = tokio::spawn(async move {
        let mut lines = BufReader::new(reader).lines();
        let request: Value =
            serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
        assert_eq!(request["method"], "thread/search");
        assert_eq!(request["params"]["limit"], 10);
        let entries = (0..11).map(|index| json!({"thread":{"id":format!("t{index}"),"name":"Task","preview":"","projectId":null,"status":{"type":"idle"},"updatedAt":0},"snippet":"过程消息"})).collect::<Vec<_>>();
        let response =
            json!({"id":request["id"],"result":{"data":entries,"nextCursor":"next-page"}});
        writer
            .write_all(format!("{response}\n").as_bytes())
            .await
            .unwrap();
        for _ in 0..10 {
            let request: Value =
                serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
            assert_eq!(request["method"], "thread/searchOccurrences");
            let result = if request["params"]["threadId"] == "t0" {
                json!({"data":[],"nextCursor":null})
            } else {
                json!({"data":[{"itemId":"item","turnId":"turn","turnCursor":"inclusive","snippet":"过程消息","snippetMatchRange":{"start":0,"end":2}}],"nextCursor":null})
            };
            writer
                .write_all(format!("{}\n", json!({"id":request["id"],"result":result})).as_bytes())
                .await
                .unwrap();
        }
    });
    let page = search_tasks(
        &connection,
        TaskSearchInput {
            query: "消息".into(),
            archived: false,
            kind: Some("history".into()),
            cursor: None,
        },
    )
    .await
    .unwrap();
    assert_eq!(page.data.len(), 9);
    assert!(page.data.iter().all(|entry| entry.occurrence.is_some()));
    assert_eq!(page.next_cursor.as_deref(), Some("next-page"));
    worker.await.unwrap();
}
