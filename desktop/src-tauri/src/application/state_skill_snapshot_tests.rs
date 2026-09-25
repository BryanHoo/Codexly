use super::{AppState, event_publisher::publish_mapped_event, snapshot_tests::snapshot};
use crate::domain::conversation::{AgentItem, AgentTaskSnapshotResponse, AgentTurn};
use serde_json::{Value, json};
use std::sync::{Arc, Mutex};
use tauri::ipc::{Channel, InvokeResponseBody};

fn user_snapshot() -> AgentTaskSnapshotResponse {
    let mut response = snapshot("project", "task");
    response.snapshot.turns.push(AgentTurn {
        id: "turn".into(),
        status: "running",
        started_at: None,
        completed_at: None,
        error: None,
        items: vec![AgentItem::Message {
            id: "user".into(),
            role: "user",
            text: "$rust 修复".into(),
            skills: None,
            skill_expansion: false,
            attachments: None,
            questions: None,
            phase: None,
        }],
    });
    response
}

async fn publish(state: &AppState, item: Value) {
    publish_mapped_event(
        &state.runtime,
        json!({
        "type":"item.started", "taskId":"task", "turnId":"turn", "itemId":item["id"],
            "payload":{"item":item}, "timestamp":"2026-09-12T00:00:00Z", "sequence":0,
            "provider":"codex", "sessionId":"codeagent-runtime", "version":2,
        })
        .into(),
        None,
        None,
    )
    .await;
}

fn expansion() -> Value {
    json!({"id":"expanded","type":"message","role":"user","text":"","skillExpansion":true,"skills":[{"name":"rust"}]})
}

#[tokio::test]
async fn native_skill_snapshot_should_seed_only_a_current_read() {
    let state = AppState::default();
    state.remember_tasks("project", ["task"]).await;
    let baseline = state.task_snapshot_baseline("project").await;
    state
        .complete_task_snapshot_at(&mut user_snapshot(), Some(baseline))
        .await;
    publish(&state, expansion()).await;
    let mut restored = user_snapshot();
    state.complete_task_snapshot(&mut restored).await;
    let item = serde_json::to_value(&restored.snapshot.turns[0].items[0]).unwrap();
    assert_eq!(item["text"], "修复");
    assert_eq!(item["skills"], json!([{"name":"rust"}]));
}

#[tokio::test]
async fn native_skill_snapshot_should_reject_seed_after_events_channel_change_or_restart() {
    for drift in ["event", "channel", "restart"] {
        let state = AppState::default();
        state.remember_tasks("project", ["task"]).await;
        let baseline = state.task_snapshot_baseline("project").await;
        match drift {
            "event" => {
                publish(
                    &state,
                    json!({"id":"assistant","type":"message","role":"assistant","text":"回复"}),
                )
                .await
            }
            "channel" => state
                .runtime
                .lock()
                .await
                .set_event_channel(Channel::new(|_| Ok(()))),
            _ => state.runtime.lock().await.restart_generation += 1,
        }
        state
            .complete_task_snapshot_at(&mut user_snapshot(), Some(baseline))
            .await;
        publish(&state, expansion()).await;
        let mut restored = user_snapshot();
        state.complete_task_snapshot(&mut restored).await;
        let item = serde_json::to_value(&restored.snapshot.turns[0].items[0]).unwrap();
        assert_eq!(item["text"], "$rust 修复", "drift: {drift}");
        assert!(item.get("skills").is_none());
    }
}

#[tokio::test]
async fn native_skill_publisher_should_emit_targeted_patch_with_the_project_sequence() {
    let state = AppState::default();
    state.remember_tasks("project", ["task"]).await;
    let received = Arc::new(Mutex::new(Vec::new()));
    let output = Arc::clone(&received);
    state
        .runtime
        .lock()
        .await
        .set_event_channel(Channel::new(move |body| {
            if let InvokeResponseBody::Json(body) = body {
                output
                    .lock()
                    .unwrap()
                    .push(serde_json::from_str::<Value>(&body).unwrap());
            }
            Ok(())
        }));
    publish(&state, json!({"id":"user","type":"message","role":"user","text":"$rust 修复","attachments":[{"id":"large-attachment"}]})).await;
    publish(&state, expansion()).await;
    let packets = received.lock().unwrap();
    let event = &packets.last().unwrap()["data"]["event"];
    assert_eq!(event["type"], "message.skills_updated");
    assert_eq!(event["itemId"], "user");
    assert_eq!(event["sequence"], 2);
    assert_eq!(
        event["payload"],
        json!({"text":"修复","skills":[{"name":"rust"}]})
    );
}
