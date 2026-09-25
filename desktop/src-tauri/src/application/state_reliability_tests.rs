use super::{AppState, RuntimeSession, spawn_event_forwarder};
use crate::domain::runtime::{AppEvent, ProviderKind, RuntimeStatus};
use crate::infrastructure::codex::{ServerMessage, map_server_request_now, server_message_channel};
use serde_json::{Value, json, value::to_raw_value};
use std::sync::{Arc, Mutex as StdMutex};
use tauri::ipc::{Channel, InvokeResponseBody};
use tokio::sync::{Mutex, oneshot};
use tokio::time::{Duration, timeout};

#[tokio::test]
async fn concurrent_start_should_wait_for_the_same_ready_runtime() {
    let state = Arc::new(AppState::default());
    let first_state = Arc::clone(&state);
    let (entered_tx, entered_rx) = oneshot::channel();
    let (ready_tx, ready_rx) = oneshot::channel();
    let first = tokio::spawn(async move {
        first_state
            .start_runtime_once(|| async {
                entered_tx.send(()).unwrap();
                ready_rx.await.unwrap();
                let mut runtime = first_state.runtime.lock().await;
                runtime.transition(RuntimeStatus::Ready, Some(ProviderKind::Codex));
                Ok(runtime.snapshot)
            })
            .await
    });
    entered_rx.await.unwrap();
    let second_state = Arc::clone(&state);
    let mut second = tokio::spawn(async move {
        second_state
            .start_runtime_once(|| async { panic!("runtime must only start once") })
            .await
    });
    assert!(
        timeout(Duration::from_millis(30), &mut second)
            .await
            .is_err()
    );
    ready_tx.send(()).unwrap();
    assert_eq!(first.await.unwrap().unwrap().status, RuntimeStatus::Ready);
    assert_eq!(second.await.unwrap().unwrap().status, RuntimeStatus::Ready);
}

async fn saturated_stream(runtime: &Arc<Mutex<RuntimeSession>>) -> Arc<StdMutex<Vec<Value>>> {
    let output = Arc::new(StdMutex::new(Vec::new()));
    let received = Arc::clone(&output);
    runtime
        .lock()
        .await
        .set_event_channel(Channel::new(move |body| {
            if let InvokeResponseBody::Json(body) = body {
                received
                    .lock()
                    .unwrap()
                    .push(serde_json::from_str(&body).unwrap());
            }
            Ok(())
        }));
    let sender = runtime.lock().await.event_sender.clone().unwrap();
    for sequence in 0..100 {
        sender.publish(AppEvent::AgentEvent {
            event: json!({
                "type":"command.output_delta", "sequence":sequence, "taskId":"thread-a",
                "payload":{"delta":"x".repeat(65_536)}
            })
            .into(),
        });
    }
    output
}

#[tokio::test]
async fn saturated_channel_should_preserve_the_final_failed_status() {
    let runtime = Arc::new(Mutex::new(RuntimeSession::default()));
    let output = saturated_stream(&runtime).await;
    let (source, messages) = server_message_channel(1);
    drop(source);
    timeout(
        Duration::from_millis(200),
        spawn_event_forwarder(Arc::clone(&runtime), messages, None),
    )
    .await
    .unwrap()
    .unwrap();
    assert!(
        output
            .lock()
            .unwrap()
            .iter()
            .any(|event| event["data"]["status"] == "failed")
    );
}

#[tokio::test]
async fn waiting_publishers_should_not_hold_runtime_lock_or_reorder_events() {
    let runtime = Arc::new(Mutex::new(RuntimeSession::default()));
    let output = saturated_stream(&runtime).await;
    let first = super::prepare_event_delivery(&runtime).await;
    let next_runtime = Arc::clone(&runtime);
    let second = tokio::spawn(async move { super::prepare_event_delivery(&next_runtime).await });
    assert!(runtime.try_lock().is_ok());
    first
        .send(AppEvent::RuntimeStatus {
            seq: 1,
            provider: None,
            status: RuntimeStatus::Starting,
        })
        .await;
    second
        .await
        .unwrap()
        .send(AppEvent::RuntimeStatus {
            seq: 2,
            provider: None,
            status: RuntimeStatus::Ready,
        })
        .await;
    let sequences: Vec<_> = output
        .lock()
        .unwrap()
        .iter()
        .filter(|event| event["type"] == "runtimeStatus")
        .map(|event| event["data"]["seq"].as_u64().unwrap())
        .collect();
    assert_eq!(sequences, vec![1, 2]);
}

#[tokio::test]
async fn saturated_channel_should_deliver_resolved_and_expired_approvals() {
    for resolved in [true, false] {
        let state = Arc::new(AppState::default());
        let output = saturated_stream(&state.runtime).await;
        let mut pending = map_server_request_now(
            ServerMessage {
                id: Some(9),
                method: "item/commandExecution/requestApproval".to_owned(),
                params: to_raw_value(&json!({
                    "threadId":"thread-a", "turnId":"turn-a", "itemId":"item-a", "kind":"command",
                    "startedAtMs":1735689600000_i64, "command":"pnpm check", "cwd":"/work/a",
                    "availableDecisions":["accept", "decline"]
                }))
                .unwrap(),
            },
            0,
        )
        .unwrap()
        .unwrap()
        .pending;
        pending.request["projectId"] = json!("project-a");
        timeout(Duration::from_millis(200), async {
            if resolved {
                state.publish_resolved_request(&pending).await.unwrap();
            } else {
                state
                    .runtime
                    .lock()
                    .await
                    .pending_requests
                    .insert("number:9".to_owned(), pending);
                let (source, messages) = server_message_channel(1);
                source
                    .send(ServerMessage {
                        id: None,
                        method: "serverRequest/resolved".to_owned(),
                        params: to_raw_value(&json!({"requestId":9})).unwrap(),
                    })
                    .await
                    .unwrap();
                drop(source);
                spawn_event_forwarder(Arc::clone(&state.runtime), messages, None)
                    .await
                    .unwrap();
            }
        })
        .await
        .expect("approval must not wait for output ACK");
        let kind = if resolved {
            "pending_request.resolved"
        } else {
            "pending_request.expired"
        };
        assert!(
            output
                .lock()
                .unwrap()
                .iter()
                .any(|event| event["data"]["event"]["type"] == kind)
        );
    }
}
