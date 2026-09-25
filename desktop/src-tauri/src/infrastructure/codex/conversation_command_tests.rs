use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, duplex, split};

use super::{
    AppServerConnection,
    conversation_advanced::{compact_task, fork_task, start_review},
    conversation_commands::{interrupt_turn, start_task, start_turn, steer_turn},
};
use crate::domain::conversation::{AgentPromptInput, AgentTurnOptions};

#[tokio::test]
async fn conversation_commands_should_follow_codex_lifecycle() {
    let (client, server) = duplex(32 * 1024);
    let (client_reader, client_writer) = split(client);
    let (server_reader, mut server_writer) = split(server);
    let connection = AppServerConnection::new(client_reader, client_writer);

    let server_task = tokio::spawn(async move {
        let mut lines = BufReader::new(server_reader).lines();
        for (method, result) in [
            (
                "project/read",
                json!({"project": {"id": "project-a", "roots": [{"path": "/work/a"}, {"path": "/work/shared"}]}}),
            ),
            (
                "thread/start",
                json!({"thread": {"id": "thread-a", "name": null, "preview": "", "projectId": "project-a", "section": null, "updatedAt": 1735689600}}),
            ),
            (
                "thread/resume",
                json!({
                    "cwd": "/work/a",
                    "instructionSources": ["/work/a/AGENTS.md"],
                    "thread": {"id": "thread-a", "projectId": "project-a"}
                }),
            ),
            (
                "turn/start",
                json!({"turn": {"id": "turn-a", "status": "inProgress", "startedAt": 1735689600, "completedAt": null, "error": null, "items": []}}),
            ),
            ("turn/steer", json!({"turnId": "turn-a"})),
            ("turn/interrupt", json!({})),
        ] {
            let request: Value = serde_json::from_str(&lines.next_line().await.unwrap().unwrap())
                .expect("request should be JSON");
            assert_eq!(request["method"], method);
            if method == "thread/start" || method == "thread/resume" {
                assert_eq!(request["params"]["config"]["web_search"], "live");
                assert_eq!(
                    request["params"]["config"]["model_reasoning_summary"],
                    "auto"
                );
                assert_eq!(request["params"]["config"]["model_verbosity"], "high");
            }
            if method == "thread/start" {
                assert_eq!(request["params"]["projectId"], "project-a");
                assert_eq!(request["params"]["cwd"], "/work/a");
                assert_eq!(
                    request["params"]["runtimeWorkspaceRoots"],
                    json!(["/work/a", "/work/shared"])
                );
                assert_eq!(request["params"]["historyMode"], "paginated");
                assert_eq!(
                    request["params"]["config"]["tools.update_plan.enabled"],
                    true
                );
            }
            if method == "thread/resume" {
                assert_eq!(request["params"]["excludeTurns"], true);
                assert!(request["params"].get("cwd").is_none());
                assert_eq!(
                    request["params"]["config"]["tools.update_plan.enabled"],
                    true
                );
            }
            if method == "turn/start" {
                assert_eq!(request["params"]["summary"], "auto");
                assert_eq!(request["params"]["threadId"], "thread-a");
                assert_eq!(request["params"]["input"][0]["text"], "修复测试");
                assert_eq!(request["params"]["model"], "gpt-5.6-sol");
                assert_eq!(request["params"]["effort"], "high");
                assert_eq!(request["params"]["approvalsReviewer"], "auto_review");
                assert_eq!(request["params"]["sandboxPolicy"]["type"], "workspaceWrite");
            }
            if method == "turn/steer" {
                assert_eq!(request["params"]["expectedTurnId"], "turn-a");
                assert_eq!(request["params"]["input"][0]["text"], "先修 Rust");
            }
            if method == "turn/interrupt" {
                assert_eq!(request["params"]["threadId"], "thread-a");
                assert_eq!(request["params"]["turnId"], "turn-a");
            }
            let response = json!({"id": request["id"].clone(), "result": result});
            server_writer
                .write_all(format!("{}\n", serde_json::to_string(&response).unwrap()).as_bytes())
                .await
                .unwrap();
        }
    });

    let settings = serde_json::from_value(json!({
        "webSearch": "live", "modelVerbosity": "high",
    }))
    .unwrap();
    let task = start_task(&connection, "project-a".to_owned(), None, &settings)
        .await
        .expect("task should start");
    assert_eq!(task.task.id, "thread-a");
    assert_eq!(
        super::task_title::take_task_title_root(&connection, "thread-a").as_deref(),
        Some("/work/a")
    );
    assert!(super::task_title::take_task_title_root(&connection, "thread-a").is_none());

    let options = AgentTurnOptions {
        approvals_reviewer: "auto_review".to_owned(),
        ..AgentTurnOptions::default()
    };
    let turn = start_turn(
        &connection,
        "project-a".to_owned(),
        "thread-a".to_owned(),
        AgentPromptInput::text("修复测试"),
        options,
        &settings,
    )
    .await
    .expect("turn should start");
    assert_eq!(turn.turn.id, "turn-a");
    assert_eq!(turn.turn.status, "running");

    steer_turn(
        &connection,
        "thread-a".to_owned(),
        "turn-a".to_owned(),
        AgentPromptInput::text("先修 Rust"),
    )
    .await
    .expect("turn should steer");
    interrupt_turn(&connection, "thread-a".to_owned(), "turn-a".to_owned())
        .await
        .expect("turn should interrupt");
    server_task.await.unwrap();
}

#[tokio::test]
async fn new_task_first_turn_should_confirm_loaded_state_after_missing_rollout() {
    let (client, server) = duplex(32 * 1024);
    let (client_reader, client_writer) = split(client);
    let (server_reader, mut server_writer) = split(server);
    let connection = AppServerConnection::new(client_reader, client_writer);

    let server_task = tokio::spawn(async move {
        let mut lines = BufReader::new(server_reader).lines();
        for (method, result) in [
            (
                "project/read",
                json!({"project": {"id": "project-a", "roots": [{"path": "/work/a"}]}}),
            ),
            (
                "thread/start",
                json!({"thread": {"id": "thread-a", "name": null, "preview": "", "projectId": "project-a", "section": null, "updatedAt": 1735689600}}),
            ),
            (
                "thread/resume",
                json!({"code": -32600, "message": "no rollout found for thread id thread-a"}),
            ),
            ("thread/read", {
                // 首条消息落盘前使用 live snapshot，项目字段尚未回填。
                let mut thread = native_task("thread-a");
                thread["projectId"] = Value::Null;
                json!({"thread": thread})
            }),
            ("turn/start", json!({"turn": native_turn("turn-a")})),
        ] {
            let request: Value = serde_json::from_str(&lines.next_line().await.unwrap().unwrap())
                .expect("request should be JSON");
            assert_eq!(request["method"], method);
            let response = if method == "thread/resume" {
                json!({"id": request["id"], "error": result})
            } else {
                json!({"id": request["id"], "result": result})
            };
            server_writer
                .write_all(format!("{}\n", serde_json::to_string(&response).unwrap()).as_bytes())
                .await
                .unwrap();
        }
    });

    let task = start_task(
        &connection,
        "project-a".to_owned(),
        None,
        &Default::default(),
    )
    .await
    .expect("task should start");
    let turn = start_turn(
        &connection,
        "project-a".to_owned(),
        task.task.id,
        AgentPromptInput::text("首条消息"),
        AgentTurnOptions::default(),
        &Default::default(),
    )
    .await
    .expect("first turn should reuse only a natively confirmed loaded thread");

    assert_eq!(turn.turn.id, "turn-a");
    server_task.await.unwrap();
}

#[tokio::test]
async fn advanced_task_commands_should_use_native_codex_methods() {
    let (client, server) = duplex(32 * 1024);
    let (client_reader, client_writer) = split(client);
    let (server_reader, mut server_writer) = split(server);
    let connection = AppServerConnection::new(client_reader, client_writer);
    let server_task = tokio::spawn(async move {
        let mut lines = BufReader::new(server_reader).lines();
        for (method, result) in [
            ("thread/read", json!({"thread": native_task("thread-a")})),
            (
                "review/start",
                json!({"reviewThreadId": "thread-a", "turn": native_turn("review-a")}),
            ),
            ("thread/read", json!({"thread": native_task("thread-a")})),
            ("thread/compact/start", json!({})),
            ("thread/read", json!({"thread": native_task("thread-a")})),
            ("thread/fork", json!({"thread": native_task("thread-b")})),
        ] {
            let request: Value =
                serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
            assert_eq!(request["method"], method);
            if method == "review/start" {
                assert_eq!(
                    request["params"]["target"],
                    json!({"type": "uncommittedChanges"})
                );
            }
            if method == "thread/fork" {
                assert_eq!(request["params"]["model"], "source-model");
                assert_eq!(
                    request["params"]["config"]["model_reasoning_effort"],
                    "xhigh"
                );
                assert_eq!(request["params"]["lastTurnId"], "turn-a");
                assert_eq!(request["params"]["excludeTurns"], true);
                assert_eq!(
                    request["params"]["config"]["tools.update_plan.enabled"],
                    true
                );
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

    let review = start_review(
        &connection,
        "project-a",
        "thread-a",
        &json!({"type": "uncommitted_changes"}),
    )
    .await
    .unwrap();
    assert_eq!(review.turn.id, "review-a");
    assert_eq!(
        compact_task(&connection, "project-a", "thread-a")
            .await
            .unwrap()
            .status,
        "compacting"
    );
    let mut settings = crate::domain::conversation::AgentTaskSettings::default();
    let forked = fork_task(
        &connection,
        "project-a",
        "thread-a",
        Some("turn-a"),
        &mut settings,
    )
    .await
    .unwrap();
    assert_eq!(forked.task.id, "thread-b");
    assert_eq!(settings.model, "source-model");
    assert_eq!(settings.reasoning_effort, "xhigh");
    server_task.await.unwrap();
}

fn native_task(id: &str) -> Value {
    json!({
        "id": id,
        "name": null,
        "preview": "任务",
        "model": "source-model",
        "reasoningEffort": "xhigh",
        "projectId": "project-a",
        "section": null,
        "status": {"type": "idle"},
        "updatedAt": 1735689600
    })
}

fn native_turn(id: &str) -> Value {
    json!({"id": id, "status": "inProgress", "startedAt": 1735689600, "completedAt": null, "error": null, "items": []})
}
