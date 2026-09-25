use serde_json::value::to_raw_value;
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, duplex, split};

use super::{
    AppServerConnection,
    connection::ServerMessage,
    conversation_advanced::{
        clear_goal, get_goal, set_goal_objective, update_goal, upload_feedback,
    },
    conversation_background::{list_background_terminals, terminate_background_terminal},
    conversation_commands::{start_task, update_thread_settings},
    conversation_events::map_server_message,
    conversation_queue::{
        add_queued_submission, delete_queued_submission, list_queued_submissions,
        reorder_queued_submissions, start_queued_submission,
    },
};

#[tokio::test]
async fn feedback_should_use_native_codex_upload() {
    let (client, server) = duplex(8 * 1024);
    let (client_reader, client_writer) = split(client);
    let (server_reader, mut server_writer) = split(server);
    let connection = AppServerConnection::new(client_reader, client_writer);
    let server_task = tokio::spawn(async move {
        let mut lines = BufReader::new(server_reader).lines();
        let request: Value = serde_json::from_str(&lines.next_line().await.unwrap().unwrap())
            .expect("request should be JSON");
        assert_eq!(request["method"], "feedback/upload");
        assert_eq!(request["params"]["threadId"], "thread-a");
        assert_eq!(request["params"]["classification"], "bug");
        assert_eq!(request["params"]["includeLogs"], true);
        server_writer
            .write_all(
                format!(
                    "{}\n",
                    json!({"id": request["id"].clone(), "result": {"threadId": "thread-a"}})
                )
                .as_bytes(),
            )
            .await
            .unwrap();
    });

    let response = upload_feedback(&connection, "thread-a", "bug", "时间线未刷新", true)
        .await
        .expect("feedback should upload");
    assert_eq!(response.task_id, "thread-a");
    server_task.await.unwrap();
}

#[tokio::test]
async fn goal_start_should_persist_settings_before_setting_objective() {
    let (client, server) = duplex(16 * 1024);
    let (client_reader, client_writer) = split(client);
    let (server_reader, mut server_writer) = split(server);
    let connection = AppServerConnection::new(client_reader, client_writer);
    let server_task = tokio::spawn(async move {
        let mut lines = BufReader::new(server_reader).lines();
        let settings: Value = serde_json::from_str(&lines.next_line().await.unwrap().unwrap())
            .expect("settings request should be JSON");
        assert_eq!(settings["method"], "thread/settings/update");
        assert_eq!(settings["params"]["threadId"], "thread-a");
        assert_eq!(settings["params"]["model"], "gpt-5.6-sol");
        assert_eq!(settings["params"]["summary"], "auto");
        server_writer
            .write_all(
                format!("{}\n", json!({"id": settings["id"].clone(), "result": {}})).as_bytes(),
            )
            .await
            .unwrap();

        let goal: Value = serde_json::from_str(&lines.next_line().await.unwrap().unwrap())
            .expect("goal request should be JSON");
        assert_eq!(goal["method"], "thread/goal/set");
        assert_eq!(goal["params"]["objective"], "持续完成迁移");
        server_writer
            .write_all(
                format!(
                    "{}\n",
                    json!({
                        "id": goal["id"].clone(),
                        "result": {"goal": {
                            "threadId": "thread-a", "objective": "持续完成迁移", "status": "active",
                            "tokenBudget": null, "tokensUsed": 0, "timeUsedSeconds": 0,
                            "createdAt": 1735689600, "updatedAt": 1735689600
                        }}
                    })
                )
                .as_bytes(),
            )
            .await
            .unwrap();
    });

    let options = crate::domain::conversation::AgentTurnOptions::default();
    update_thread_settings(&connection, "thread-a", &options)
        .await
        .expect("thread settings should persist");
    let goal = set_goal_objective(&connection, "thread-a", "持续完成迁移")
        .await
        .expect("goal should start");
    assert_eq!(goal.goal.objective, "持续完成迁移");
    server_task.await.unwrap();
}
use crate::domain::conversation::AgentPromptInput;

#[tokio::test]
async fn native_goal_commands_should_map_protocol_contract() {
    let (client, server) = duplex(16 * 1024);
    let (client_reader, client_writer) = split(client);
    let (server_reader, mut server_writer) = split(server);
    let connection = AppServerConnection::new(client_reader, client_writer);

    let server_task = tokio::spawn(async move {
        let mut lines = BufReader::new(server_reader).lines();
        for (method, result) in [
            (
                "thread/goal/get",
                json!({"goal": native_goal("active", 1735689600)}),
            ),
            (
                "thread/goal/set",
                json!({"goal": native_goal("paused", 1735689700)}),
            ),
            ("thread/goal/clear", json!({"cleared": true})),
        ] {
            let request: Value =
                serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
            assert_eq!(request["method"], method);
            assert_eq!(request["params"]["threadId"], "thread-a");
            if method == "thread/goal/set" {
                assert_eq!(request["params"]["status"], "paused");
                assert!(request["params"].get("objective").is_none());
            }
            server_writer
                .write_all(
                    format!(
                        "{}\n",
                        json!({"id": request["id"].clone(), "result": result})
                    )
                    .as_bytes(),
                )
                .await
                .unwrap();
        }
    });

    let goal = get_goal(&connection, "thread-a")
        .await
        .expect("goal should map")
        .expect("goal should exist");
    assert_eq!(goal.objective, "完成工作台迁移");
    assert_eq!(goal.status, "active");
    assert_eq!(goal.created_at, "2025-01-01T00:00:00Z");

    let updated = update_goal(&connection, "thread-a", "paused")
        .await
        .expect("goal should update");
    assert_eq!(updated.goal.status, "paused");
    assert_eq!(updated.goal.updated_at, "2025-01-01T00:01:40Z");

    let cleared = clear_goal(&connection, "thread-a")
        .await
        .expect("goal should clear");
    assert!(cleared.cleared);
    server_task.await.unwrap();
}

#[tokio::test]
async fn native_background_terminal_commands_should_map_protocol_contract() {
    let (client, server) = duplex(16 * 1024);
    let (client_reader, client_writer) = split(client);
    let (server_reader, mut server_writer) = split(server);
    let connection = AppServerConnection::new(client_reader, client_writer);

    let server_task = tokio::spawn(async move {
        let mut lines = BufReader::new(server_reader).lines();
        let list_request: Value =
            serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
        assert_eq!(list_request["method"], "thread/backgroundTerminals/list");
        assert_eq!(list_request["params"]["threadId"], "thread-a");
        server_writer
            .write_all(
                format!(
                    "{}\n",
                    json!({"id": list_request["id"].clone(), "result": {
                        "data": [{
                            "itemId": "item-a", "processId": "42", "command": "pnpm check",
                            "cwd": "/work/a", "osPid": 42, "cpuPercent": 1.5, "rssKb": 1024
                        }],
                        "nextCursor": null
                    }})
                )
                .as_bytes(),
            )
            .await
            .unwrap();

        let terminate_request: Value =
            serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
        assert_eq!(
            terminate_request["method"],
            "thread/backgroundTerminals/terminate"
        );
        assert_eq!(terminate_request["params"]["processId"], "42");
        server_writer
            .write_all(
                format!(
                    "{}\n",
                    json!({"id": terminate_request["id"].clone(), "result": {"terminated": true}})
                )
                .as_bytes(),
            )
            .await
            .unwrap();
    });

    let page = list_background_terminals(&connection, "thread-a")
        .await
        .expect("terminals should map");
    assert_eq!(page.data[0].id, "42");
    assert_eq!(page.data[0].item_id, "item-a");
    assert_eq!(page.data[0].cwd, "/work/a");

    let response = terminate_background_terminal(&connection, "thread-a", "42")
        .await
        .expect("terminal should terminate");
    assert_eq!(response.status, "terminated");
    assert_eq!(response.terminal_id, "42");
    server_task.await.unwrap();
}

#[test]
fn native_goal_notifications_should_map_to_runtime_events() {
    let updated = map_server_message(
        ServerMessage {
            id: None,
            method: "thread/goal/updated".to_owned(),
            params: to_raw_value(&json!({
                "threadId": "thread-a",
                "turnId": "turn-a",
                "goal": native_goal("blocked", 1735689700),
            }))
            .unwrap(),
        },
        8,
        "2025-01-01T00:02:00Z",
    )
    .expect("notification should map")
    .expect("notification should be supported");
    assert_eq!(updated["type"], "goal.updated");
    assert_eq!(updated["payload"]["goal"]["status"], "blocked");
    assert_eq!(updated["payload"]["goal"]["tokenBudget"], 1000);

    let cleared = map_server_message(
        ServerMessage {
            id: None,
            method: "thread/goal/cleared".to_owned(),
            params: to_raw_value(&json!({"threadId": "thread-a"})).unwrap(),
        },
        9,
        "2025-01-01T00:02:00Z",
    )
    .expect("notification should map")
    .expect("notification should be supported");
    assert_eq!(cleared["type"], "goal.cleared");
}

#[tokio::test]
async fn native_queue_commands_should_preserve_submission_order_and_content() {
    let (client, server) = duplex(32 * 1024);
    let (client_reader, client_writer) = split(client);
    let (server_reader, mut server_writer) = split(server);
    let connection = AppServerConnection::new(client_reader, client_writer);
    let queued = json!({
        "id": "queue-a",
        "input": [{"type": "text", "text": "继续修复", "text_elements": []}],
        "clientUserMessageId": "message-a"
    });

    let server_task = tokio::spawn(async move {
        let mut lines = BufReader::new(server_reader).lines();
        let cases = [
            (
                "thread/queue/list",
                json!({"data": [queued.clone()], "nextCursor": null}),
            ),
            (
                "thread/queue/add",
                json!({"queuedSubmission": queued.clone()}),
            ),
            ("thread/queue/reorder", json!({})),
            ("thread/queue/delete", json!({"deleted": true})),
            (
                "thread/queue/start",
                json!({"turn": {
                    "id": "turn-a", "status": "inProgress", "startedAt": 1735689600,
                    "completedAt": null, "error": null, "items": []
                }}),
            ),
        ];
        for (method, result) in cases {
            let request: Value =
                serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
            assert_eq!(request["method"], method);
            assert_eq!(request["params"]["threadId"], "thread-a");
            if method == "thread/queue/add" {
                assert_eq!(request["params"]["input"][0]["text"], "继续修复");
            }
            if method == "thread/queue/reorder" {
                assert_eq!(request["params"]["queuedSubmissionIds"], json!(["queue-a"]));
            }
            server_writer
                .write_all(
                    format!(
                        "{}\n",
                        json!({"id": request["id"].clone(), "result": result})
                    )
                    .as_bytes(),
                )
                .await
                .unwrap();
        }
    });

    let input = AgentPromptInput::text("继续修复");
    let page = list_queued_submissions(&connection, "thread-a", None, Some(100))
        .await
        .expect("queue should list");
    assert_eq!(page.data[0].id, "queue-a");
    assert_eq!(page.data[0].text, "继续修复");
    assert_eq!(page.data[0].status, "queued");

    add_queued_submission(&connection, "thread-a", &input, "message-a")
        .await
        .expect("submission should add");
    reorder_queued_submissions(&connection, "thread-a", &["queue-a".to_owned()])
        .await
        .expect("queue should reorder");
    assert!(
        delete_queued_submission(&connection, "thread-a", "queue-a")
            .await
            .expect("submission should delete")
            .deleted
    );
    let started = start_queued_submission(&connection, "thread-a", Some("queue-a"))
        .await
        .expect("submission should start");
    assert_eq!(started.task_id, "thread-a");
    assert_eq!(started.turn.id, "turn-a");
    server_task.await.unwrap();
}

#[test]
fn native_queue_changed_notification_should_map_to_runtime_event() {
    let event = map_server_message(
        ServerMessage {
            id: None,
            method: "thread/queue/changed".to_owned(),
            params: to_raw_value(&json!({"threadId": "thread-a"})).unwrap(),
        },
        10,
        "2025-01-01T00:02:00Z",
    )
    .expect("notification should map")
    .expect("notification should be supported");
    assert_eq!(event["type"], "queue.changed");
}

#[tokio::test]
async fn temporary_task_should_start_without_project_context() {
    let (client, server) = duplex(8 * 1024);
    let (client_reader, client_writer) = split(client);
    let (server_reader, mut server_writer) = split(server);
    let connection = AppServerConnection::new(client_reader, client_writer);
    let temporary_cwd = std::env::temp_dir()
        .join("codeagent-temporary-workspaces")
        .join("task-1");
    let expected_cwd = temporary_cwd.to_str().unwrap().to_owned();
    let server_task = tokio::spawn(async move {
        let mut lines = BufReader::new(server_reader).lines();
        let request: Value =
            serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
        assert_eq!(request["method"], "thread/start");
        assert_eq!(request["params"]["historyMode"], "paginated");
        assert_eq!(
            request["params"]["config"]["tools.update_plan.enabled"],
            true
        );
        assert!(request["params"]["projectId"].is_null());
        assert_eq!(request["params"]["cwd"], expected_cwd);
        assert!(request["params"]["runtimeWorkspaceRoots"].is_null());
        server_writer
            .write_all(
                format!(
                    "{}\n",
                    json!({"id": request["id"].clone(), "result": {"thread": {
                        "id": "thread-temp", "name": null, "preview": "", "projectId": null,
                        "section": null, "updatedAt": 1735689600
                    }}})
                )
                .as_bytes(),
            )
            .await
            .unwrap();
    });

    let response = start_task(
        &connection,
        "temporary".to_owned(),
        Some(&temporary_cwd),
        &Default::default(),
    )
    .await
    .expect("temporary task should start");
    assert_eq!(response.task.project_id, "temporary");
    assert_eq!(response.task.id, "thread-temp");
    server_task.await.unwrap();
}

fn native_goal(status: &str, updated_at: i64) -> Value {
    json!({
        "threadId": "thread-a",
        "objective": "完成工作台迁移",
        "status": status,
        "tokenBudget": 1000,
        "tokensUsed": 120,
        "timeUsedSeconds": 30,
        "createdAt": 1735689600,
        "updatedAt": updated_at,
    })
}
