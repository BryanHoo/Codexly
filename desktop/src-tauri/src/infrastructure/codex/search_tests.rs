use super::*;
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, duplex, split};

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
            assert_eq!(params["limit"], 30);
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
