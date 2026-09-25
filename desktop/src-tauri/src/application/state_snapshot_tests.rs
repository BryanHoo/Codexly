use super::{AppState, event_forwarder::publish_mapped_event};
use crate::domain::conversation::{
    AgentTaskSettings, AgentTaskSnapshot, AgentTaskSnapshotResponse, AgentThreadConfiguration,
    EventCheckpoint,
};
use crate::infrastructure::codex::{RUNTIME_SESSION_ID, ServerMessage, map_server_request_now};
use serde_json::{Value, json, value::to_raw_value};

pub(super) fn snapshot(project: &str, task: &str) -> AgentTaskSnapshotResponse {
    AgentTaskSnapshotResponse {
        checkpoint: EventCheckpoint {
            sequence: 0,
            session_id: RUNTIME_SESSION_ID,
        },
        snapshot: AgentTaskSnapshot {
            context_usage: None,
            goal: None,
            id: task.into(),
            pending_requests: vec![],
            pinned: false,
            plan: None,
            project_id: project.into(),
            settings: AgentTaskSettings::default(),
            thread_configuration: AgentThreadConfiguration {
                model: None,
                reasoning_effort: None,
            },
            status: "running",
            title: "Task".into(),
            turns: vec![],
            turns_next_cursor: None,
            updated_at: "2026-09-12T00:00:00Z".into(),
        },
    }
}

#[tokio::test]
async fn native_snapshot_restores_non_retrying_error_for_the_matching_failed_turn() {
    let state = AppState::default();
    state.remember_tasks("project-a", ["task-a"]).await;
    publish(
        &state,
        "task-a",
        "provider.error",
        json!({
            "message":"Provider failed", "willRetry":false
        }),
    )
    .await;
    publish(
        &state,
        "task-a",
        "turn.completed",
        json!({
            "turn":{"id":"turn-a", "status":"failed", "error":null, "items":[]}
        }),
    )
    .await;
    let mut response = snapshot("project-a", "task-a");
    response
        .snapshot
        .turns
        .push(crate::domain::conversation::AgentTurn {
            id: "turn-a".into(),
            started_at: None,
            completed_at: None,
            status: "failed",
            error: None,
            items: vec![],
        });
    state.complete_task_snapshot(&mut response).await;
    assert_eq!(
        response.snapshot.turns[0].error.as_deref(),
        Some("Provider failed")
    );
    assert_eq!(response.checkpoint.sequence, 2);
    // 历史页中的其他回合、其他项目以及上游已有错误均不能被缓存改写。
    for (project, turn_id, status, explicit_error) in [
        ("project-b", "turn-a", "failed", None),
        ("project-a", "turn-b", "failed", None),
        ("project-a", "turn-a", "running", None),
        ("project-a", "turn-a", "completed", None),
        ("project-a", "turn-a", "failed", Some("Historical failure")),
    ] {
        response.snapshot.project_id = project.into();
        response.snapshot.turns[0].id = turn_id.into();
        response.snapshot.turns[0].status = status;
        response.snapshot.turns[0].error = explicit_error.map(str::to_owned);
        state.complete_task_snapshot(&mut response).await;
        assert_eq!(response.snapshot.turns[0].error.as_deref(), explicit_error);
    }
}

async fn publish(state: &AppState, task: &str, kind: &str, payload: Value) {
    assert!(
        publish_mapped_event(
            &state.runtime,
            json!({
                "taskId": task, "turnId": "turn-a", "type": kind, "payload": payload,
                "timestamp": "2026-09-12T00:00:00Z", "sessionId": RUNTIME_SESSION_ID,
                "provider": "codex", "version": 2,
            })
            .into(),
            None,
            None
        )
        .await
    );
}

#[tokio::test]
async fn native_snapshot_restores_realtime_skill_merge_without_a_webview() {
    let state = AppState::default();
    state.remember_tasks("project-a", ["task-a"]).await;
    for item in [
        json!({"id":"user", "type":"message", "role":"user", "text":"$rust 修复代码"}),
        json!({"id":"expanded", "type":"message", "role":"user", "text":"", "skills":[{"name":"rust"}], "skillExpansion":true}),
    ] {
        publish_mapped_event(
            &state.runtime,
            json!({
            "type":"item.started", "taskId":"task-a", "turnId":"turn-a", "itemId":item["id"],
                "payload":{"item":item}, "timestamp":"2026-09-12T00:00:00Z", "sequence":0,
                "provider":"codex", "sessionId":RUNTIME_SESSION_ID, "version":2,
            })
            .into(),
            None,
            None,
        )
        .await;
    }
    let mut response = snapshot("project-a", "task-a");
    response
        .snapshot
        .turns
        .push(crate::domain::conversation::AgentTurn {
            id: "turn-a".into(),
            started_at: None,
            completed_at: None,
            error: None,
            status: "running",
            items: vec![crate::domain::conversation::AgentItem::Message {
                id: "user".into(),
                role: "user",
                text: "$rust 修复代码".into(),
                skills: None,
                attachments: Some(vec![json!({"id":"attachment"})]),
                phase: None,
                questions: None,
                skill_expansion: false,
            }],
        });
    state.complete_task_snapshot(&mut response).await;
    let item = serde_json::to_value(&response.snapshot.turns[0].items[0]).unwrap();
    assert_eq!(item["text"], "修复代码");
    assert_eq!(item["skills"], json!([{"name":"rust"}]));
    assert_eq!(item["attachments"][0]["id"], "attachment");
    assert_eq!(response.checkpoint.sequence, 2);
}

#[tokio::test]
async fn native_snapshot_restores_metadata_without_a_webview() {
    let state = AppState::default();
    state
        .remember_tasks("project-a", ["task-a", "task-b"])
        .await;
    let usage = json!({"contextWindow":200_000,"usedTokens":48_000});
    let plan =
        json!({"explanation":"Implementation", "steps":[{"text":"Test", "status":"in_progress"}]});
    publish(&state, "task-a", "usage.updated", json!({"usage":usage})).await;
    publish(&state, "task-a", "plan.updated", json!({"plan":plan})).await;
    publish(
        &state,
        "task-b",
        "usage.updated",
        json!({"usage":{"usedTokens":9}}),
    )
    .await;
    let mut response = snapshot("project-a", "task-a");
    state.complete_task_snapshot(&mut response).await;
    assert_eq!(response.snapshot.context_usage, Some(usage));
    assert_eq!(response.snapshot.plan, Some(plan));
    assert_eq!(response.checkpoint.sequence, 3);
    assert!(state.runtime.lock().await.event_sender.is_none());
}

#[tokio::test]
async fn native_snapshot_restores_only_live_requests_for_the_same_task_and_project() {
    let state = AppState::default();
    state
        .remember_tasks("project-a", ["task-a", "task-b"])
        .await;
    for (id, task) in [(9, "task-a"), (10, "task-b")] {
        let mapped = map_server_request_now(
            ServerMessage {
                id: Some(id),
                method: "item/commandExecution/requestApproval".into(),
                params: to_raw_value(&json!({
                    "threadId":task,"turnId":"turn-a","itemId":"item-a","kind":"command",
                    "command":"pwd","cwd":"/work","startedAtMs":1735689600000_i64,
                    "availableDecisions":["accept","decline"]
                }))
                .unwrap(),
            },
            0,
        )
        .unwrap()
        .unwrap();
        assert!(
            publish_mapped_event(
                &state.runtime,
                mapped.event.into(),
                Some(mapped.pending),
                None
            )
            .await
        );
    }
    let mut response = snapshot("project-a", "task-a");
    state.complete_task_snapshot(&mut response).await;
    assert_eq!(response.snapshot.pending_requests.len(), 1);
    assert_eq!(
        response.snapshot.pending_requests[0]["requestId"],
        "number:9"
    );
    let mut unrelated = snapshot("project-b", "task-a");
    state.complete_task_snapshot(&mut unrelated).await;
    assert!(unrelated.snapshot.pending_requests.is_empty());
    let request = state.take_pending_request("number:9").await.unwrap();
    state.publish_resolved_request(&request).await.unwrap();
    state.complete_task_snapshot(&mut response).await;
    assert!(response.snapshot.pending_requests.is_empty());
}

#[tokio::test]
async fn native_snapshot_removes_deleted_task_metadata() {
    let state = AppState::default();
    state.remember_tasks("project-a", ["task-a"]).await;
    publish(
        &state,
        "task-a",
        "usage.updated",
        json!({"usage":{"usedTokens":48}}),
    )
    .await;
    publish(&state, "task-a", "task.removed", json!({})).await;
    let mut response = snapshot("project-a", "task-a");
    state.complete_task_snapshot(&mut response).await;
    assert!(response.snapshot.context_usage.is_none());
}

#[tokio::test]
async fn native_snapshot_survives_webview_reconnection_but_not_provider_restart() {
    use crate::domain::runtime::{ProviderKind, RuntimeStatus};
    use tauri::ipc::Channel;
    let state = AppState::default();
    state.remember_tasks("project-a", ["task-a"]).await;
    state
        .runtime
        .lock()
        .await
        .transition(RuntimeStatus::Ready, Some(ProviderKind::Codex));
    publish(
        &state,
        "task-a",
        "usage.updated",
        json!({"usage":{"contextWindow":100,"usedTokens":48}}),
    )
    .await;
    for _ in 0..2 {
        state.connect(Channel::new(|_| Ok(()))).await;
        state
            .start_runtime_once(|| async { panic!("WebView reconnection must reuse the provider") })
            .await
            .unwrap();
        let mut response = snapshot("project-a", "task-a");
        state.complete_task_snapshot(&mut response).await;
        let encoded = serde_json::to_value(response).unwrap();
        assert_eq!(
            encoded["snapshot"]["contextUsage"],
            json!({"contextWindow":100,"usedTokens":48})
        );
        assert_eq!(
            encoded["checkpoint"],
            json!({"sequence":1,"sessionId":RUNTIME_SESSION_ID})
        );
    }
    state
        .runtime
        .lock()
        .await
        .transition(RuntimeStatus::Failed, Some(ProviderKind::Codex));
    state
        .start_runtime_once(|| async {
            let mut runtime = state.runtime.lock().await;
            runtime.transition(RuntimeStatus::Ready, Some(ProviderKind::Codex));
            Ok(runtime.snapshot)
        })
        .await
        .unwrap();
    let mut response = snapshot("project-a", "task-a");
    state.complete_task_snapshot(&mut response).await;
    assert!(response.snapshot.context_usage.is_none());
}
