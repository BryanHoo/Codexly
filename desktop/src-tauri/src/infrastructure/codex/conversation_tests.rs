use serde_json::value::to_raw_value;
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, duplex, split};

use super::{
    AppServerConnection, connection::ServerMessage, conversation::read_task_snapshot,
    conversation_events::map_server_message,
};

#[tokio::test]
async fn read_task_snapshot_should_map_native_thread_history() {
    let (client, server) = duplex(32 * 1024);
    let (client_reader, client_writer) = split(client);
    let (server_reader, mut server_writer) = split(server);
    let connection = AppServerConnection::new(client_reader, client_writer);

    let server_task = tokio::spawn(async move {
        let mut lines = BufReader::new(server_reader).lines();
        let request: Value = serde_json::from_str(&lines.next_line().await.unwrap().unwrap())
            .expect("request should be JSON");
        assert_eq!(request["method"], "thread/read");
        assert_eq!(request["params"]["threadId"], "thread-a");
        assert_eq!(request["params"]["includeTurns"], false);

        let turn = json!({
            "id": "turn-a",
            "status": "completed",
            "startedAt": 1735689500,
            "completedAt": 1735689600,
            "error": null,
            "items": []
        });
        let response = json!({
            "id": request["id"].clone(),
            "result": {
                "thread": {
                    "id": "thread-a",
                    "name": "真实会话",
                    "preview": "ignored",
                    "projectId": "project-a",
                    "historyMode": "paginated",
                    "section": null,
                    "updatedAt": 1735689600,
                    "status": {"type": "idle"}
                }
            }
        });
        server_writer
            .write_all(format!("{}\n", serde_json::to_string(&response).unwrap()).as_bytes())
            .await
            .unwrap();

        let page_request: Value =
            serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
        assert_eq!(page_request["method"], "thread/turns/list");
        assert_eq!(page_request["params"]["itemsView"], "notLoaded");
        assert_eq!(page_request["params"]["limit"], 10);
        assert_eq!(page_request["params"]["sortDirection"], "desc");
        server_writer
            .write_all(
                format!(
                    "{}\n",
                    json!({"id": page_request["id"].clone(), "result": {"data": [turn], "nextCursor": "older-a"}})
                )
                .as_bytes(),
            )
            .await
            .unwrap();

        let items_request: Value =
            serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
        assert_eq!(items_request["method"], "thread/items/list");
        assert_eq!(items_request["params"]["threadId"], "thread-a");
        assert_eq!(items_request["params"]["turnId"], "turn-a");
        assert_eq!(items_request["params"]["limit"], 100);
        assert_eq!(items_request["params"]["sortDirection"], "desc");
        let items = json!([
            {"turnId": "turn-a", "item": {"id": "tool-a", "type": "mcpToolCall", "server": "docs", "tool": "search", "status": "completed", "arguments": {"query": "Codex"}, "result": {"content": [{"type": "text", "text": "found"}]}, "error": null}},
            {"turnId": "turn-a", "item": {"id": "diff-a", "type": "fileChange", "status": "completed", "changes": [{"path": "/work/a/src/a.ts", "kind": {"type": "update"}, "diff": "@@ -1 +1 @@\n-old\n+new"}]}},
            {"turnId": "turn-a", "item": {"id": "command-a", "type": "commandExecution", "command": "pnpm check", "cwd": "/work/a", "status": "completed", "aggregatedOutput": "ok\n", "exitCode": 0}},
            {"turnId": "turn-a", "item": {"id": "reason-a", "type": "reasoning", "summary": ["摘要"], "content": ["推理"]}},
            {"turnId": "turn-a", "item": {"id": "agent-a", "type": "agentMessage", "text": "已完成", "phase": "final_answer", "delivery": null}},
            {"turnId": "turn-a", "item": {"id": "expanded-skill", "type": "userMessage", "content": [{"type": "skill", "name": "rust", "path": "/skills/rust"}]}},
            {"turnId": "turn-a", "item": {"id": "user-a", "type": "userMessage", "content": [{"type": "text", "text": "$rust 检查代码", "text_elements": []}]}}
        ]);
        server_writer
            .write_all(
                format!(
                    "{}\n",
                    json!({"id": items_request["id"].clone(), "result": {"data": items, "nextCursor": null, "backwardsCursor": "newest-a"}})
                )
                .as_bytes(),
            )
            .await
            .unwrap();

        let goal_request: Value =
            serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
        assert_eq!(goal_request["method"], "thread/goal/get");
        server_writer
            .write_all(
                format!(
                    "{}\n",
                    json!({"id": goal_request["id"].clone(), "result": {"goal": null}})
                )
                .as_bytes(),
            )
            .await
            .unwrap();
    });

    let snapshot = read_task_snapshot(
        &connection,
        "project-a".to_owned(),
        "thread-a".to_owned(),
        None,
    )
    .await
    .expect("snapshot should map");
    let value = serde_json::to_value(snapshot).expect("snapshot should serialize");

    assert_eq!(value["snapshot"]["title"], "真实会话");
    assert_eq!(value["snapshot"]["status"], "idle");
    assert_eq!(value["snapshot"]["turnsNextCursor"], "older-a");
    assert_eq!(value["snapshot"]["turns"][0]["items"][0]["type"], "message");
    assert_eq!(
        value["snapshot"]["turns"][0]["items"][0]["text"],
        "检查代码"
    );
    assert_eq!(
        value["snapshot"]["turns"][0]["items"][0]["skills"],
        json!([{"name":"rust"}])
    );
    assert_eq!(
        value["snapshot"]["turns"][0]["items"][1]["phase"],
        "final_answer"
    );
    let items = value["snapshot"]["turns"][0]["items"].as_array().unwrap();
    assert_eq!(items[2]["type"], "reasoning");
    assert_eq!(items[2]["text"], "摘要");
    assert_eq!(items[3]["command"], "pnpm check");
    assert_eq!(items[4]["type"], "file_change");
    assert_eq!(items[5]["name"], "docs/search");
    assert_eq!(
        value["checkpoint"],
        json!({"sequence": 0, "sessionId": "codeagent-runtime"})
    );
    server_task.await.unwrap();
}

#[test]
fn server_notifications_should_map_to_agent_events() {
    let timestamp = "2025-01-01T00:00:00Z";
    let delta = map_server_message(
        ServerMessage {
            id: None,
            method: "item/agentMessage/delta".to_owned(),
            params: to_raw_value(&json!({
                "threadId": "thread-a",
                "turnId": "turn-a",
                "itemId": "item-a",
                "delta": "完成"
            }))
            .unwrap(),
        },
        3,
        timestamp,
    )
    .expect("notification should map")
    .expect("notification should be supported");
    assert_eq!(
        delta,
        json!({
            "itemId": "item-a",
            "payload": {"delta": "完成"},
            "provider": "codex",
            "sequence": 3,
            "sessionId": "codeagent-runtime",
            "taskId": "thread-a",
            "timestamp": timestamp,
            "turnId": "turn-a",
            "type": "message.delta",
            "version": 2
        })
    );

    let started = map_server_message(
        ServerMessage {
            id: None,
            method: "turn/started".to_owned(),
            params: to_raw_value(&json!({
                "threadId": "thread-a",
                "turn": {"id": "turn-a", "status": "inProgress", "startedAt": 1735689600, "completedAt": null, "error": null, "items": []}
            }))
            .unwrap(),
        },
        4,
        timestamp,
    )
    .expect("notification should map")
    .expect("notification should be supported");
    assert_eq!(started["type"], "turn.started");
    assert_eq!(started["payload"]["turn"]["status"], "running");
    assert_eq!(started["turnId"], "turn-a");
}

#[test]
fn workbench_notifications_should_map_complete_timeline_state() {
    let timestamp = "2025-01-01T00:00:00Z";
    let cases = [
        (
            "turn/plan/updated",
            json!({
                "threadId": "thread-a", "turnId": "turn-a", "explanation": "执行计划",
                "plan": [{"step": "补测试", "status": "inProgress"}]
            }),
            "plan.updated",
        ),
        (
            "thread/tokenUsage/updated",
            json!({
                "threadId": "thread-a", "turnId": "turn-a",
                "tokenUsage": {"total": {"totalTokens": 120}, "last": {"totalTokens": 40}, "modelContextWindow": 1000}
            }),
            "usage.updated",
        ),
        (
            "error",
            json!({
                "threadId": "thread-a", "turnId": "turn-a", "willRetry": false,
                "error": {"message": "请求失败", "codexErrorInfo": {"httpStatusCode": 429}}
            }),
            "provider.error",
        ),
        (
            "item/mcpToolCall/progress",
            json!({
                "threadId": "thread-a", "turnId": "turn-a", "itemId": "item-a",
                "message": "正在查询"
            }),
            "tool.progress",
        ),
        (
            "item/fileChange/patchUpdated",
            json!({
                "threadId": "thread-a", "turnId": "turn-a", "itemId": "item-a",
                "changes": [{"path": "src/a.ts", "kind": {"type": "add"}, "diff": "+new"}]
            }),
            "file_change.updated",
        ),
        (
            "mcpServer/startupStatus/updated",
            json!({
                "threadId": "thread-a", "name": "context7", "status": "ready", "error": null, "failureReason": null
            }),
            "mcp_server.status_updated",
        ),
    ];

    for (index, (method, params, event_type)) in cases.into_iter().enumerate() {
        let event = map_server_message(
            ServerMessage {
                id: None,
                method: method.to_owned(),
                params: to_raw_value(&params).unwrap(),
            },
            index as u64 + 1,
            timestamp,
        )
        .expect("notification should map")
        .expect("notification should be supported");
        assert_eq!(event["type"], event_type);
        if method == "thread/tokenUsage/updated" {
            assert_eq!(event["payload"]["usage"]["usedTokens"], 40);
        }
        if method == "mcpServer/startupStatus/updated" {
            assert_eq!(event["taskId"], "thread-a");
            assert_eq!(event["payload"]["name"], "context7");
            assert_eq!(event["payload"]["status"], "ready");
        }
    }
}

#[test]
fn sidebar_notifications_should_map_task_lifecycle() {
    let timestamp = "2025-01-01T00:00:00Z";
    let cases = [
        (
            "thread/status/changed",
            json!({"threadId": "thread-a", "status": {"type": "active"}}),
            "task.status_updated",
        ),
        (
            "thread/name/updated",
            json!({"threadId": "thread-a", "threadName": "新标题"}),
            "task.metadata_changed",
        ),
        (
            "thread/archived",
            json!({"threadId": "thread-a"}),
            "task.removed",
        ),
        (
            "thread/deleted",
            json!({"threadId": "thread-a"}),
            "task.removed",
        ),
    ];

    for (index, (method, params, event_type)) in cases.into_iter().enumerate() {
        let event = map_server_message(
            ServerMessage {
                id: None,
                method: method.to_owned(),
                params: to_raw_value(&params).unwrap(),
            },
            index as u64 + 1,
            timestamp,
        )
        .expect("notification should map")
        .expect("notification should be supported");
        assert_eq!(event["type"], event_type);
        if method == "thread/name/updated" {
            assert_eq!(event["payload"]["title"], "新标题");
        }
    }
}

#[test]
fn runtime_notifications_should_map_visible_timeline_state() {
    let timestamp = "2025-01-01T00:00:00Z";
    let cases = [
        (
            "model/rerouted",
            json!({
                "threadId": "thread-a", "turnId": "turn-a",
                "fromModel": "gpt-5.6-sol", "toModel": "gpt-5.6-terra", "reason": "fallback"
            }),
            "item.completed",
        ),
        (
            "model/safetyBuffering/updated",
            json!({
                "threadId": "thread-a", "turnId": "turn-a", "model": "gpt-5.6-sol",
                "useCases": [], "reasons": [], "showBufferingUi": true, "fasterModel": null
            }),
            "item.started",
        ),
        (
            "model/verification",
            json!({"threadId": "thread-a", "turnId": "turn-a", "verifications": []}),
            "task.notice",
        ),
    ];

    for (index, (method, params, event_type)) in cases.into_iter().enumerate() {
        let event = map_server_message(
            ServerMessage {
                id: None,
                method: method.to_owned(),
                params: to_raw_value(&params).unwrap(),
            },
            index as u64 + 1,
            timestamp,
        )
        .expect("notification should map")
        .expect("notification should be supported");
        assert_eq!(event["type"], event_type);
    }
}

#[test]
fn context_compaction_lifecycle_should_map_visible_running_state() {
    let timestamp = "2025-01-01T00:00:00Z";

    for (index, (method, expected_status)) in
        [("item/started", "running"), ("item/completed", "completed")]
            .into_iter()
            .enumerate()
    {
        let event = map_server_message(
            ServerMessage {
                id: None,
                method: method.to_owned(),
                params: to_raw_value(&json!({
                    "threadId": "thread-a",
                    "turnId": "turn-a",
                    "item": {"id": "compact-a", "type": "contextCompaction"}
                }))
                .unwrap(),
            },
            index as u64 + 1,
            timestamp,
        )
        .expect("notification should map")
        .expect("notification should be supported");

        assert_eq!(event["payload"]["item"]["type"], "activity");
        assert_eq!(event["payload"]["item"]["label"], "上下文压缩");
        assert_eq!(event["payload"]["item"]["status"], expected_status);
        assert_eq!(event["payload"]["item"]["transient"], true);
    }
}

#[test]
fn hook_and_auto_review_notifications_should_map_timeline_items() {
    let timestamp = "2025-01-01T00:00:00Z";
    let cases = [
        (
            "hook/started",
            json!({
                "threadId": "thread-a", "turnId": "turn-a",
                "run": {
                    "id": "hook-a", "eventName": "SessionStart", "status": "running",
                    "statusMessage": "准备环境", "durationMs": null
                }
            }),
            "item.started",
            "runtime_status",
        ),
        (
            "item/autoApprovalReview/started",
            json!({
                "threadId": "thread-a", "turnId": "turn-a", "reviewId": "review-a",
                "targetItemId": "command-a", "startedAtMs": 1735689600000_i64,
                "review": {
                    "status": "inProgress", "riskLevel": "low",
                    "userAuthorization": "medium", "rationale": "命令风险较低"
                },
                "action": {"type": "command", "command": "pnpm check", "cwd": "/work"}
            }),
            "item.started",
            "approval_review",
        ),
        (
            "item/autoApprovalReview/completed",
            json!({
                "threadId": "thread-a", "turnId": "turn-a", "reviewId": "review-a",
                "targetItemId": "command-a", "startedAtMs": 1735689600000_i64,
                "completedAtMs": 1735689600100_i64, "decisionSource": "agent",
                "review": {
                    "status": "approved", "riskLevel": "low",
                    "userAuthorization": "medium", "rationale": "命令风险较低"
                },
                "action": {"type": "command", "command": "pnpm check", "cwd": "/work"}
            }),
            "item.completed",
            "approval_review",
        ),
    ];

    for (index, (method, params, event_type, item_type)) in cases.into_iter().enumerate() {
        let event = map_server_message(
            ServerMessage {
                id: None,
                method: method.to_owned(),
                params: to_raw_value(&params).unwrap(),
            },
            index as u64 + 1,
            timestamp,
        )
        .expect("notification should map")
        .expect("notification should be supported");
        assert_eq!(event["type"], event_type);
        assert_eq!(event["payload"]["item"]["type"], item_type);
    }
}
