use std::sync::{
    Arc, Mutex as StdMutex,
    atomic::{AtomicBool, Ordering},
};

use serde_json::{Value, json, value::to_raw_value};
use tauri::ipc::{Channel, InvokeResponseBody};
use tokio::{
    sync::Mutex,
    time::{Duration, sleep, timeout},
};

use super::runtime_supervisor::runtime_restart_plan;
use super::{RuntimePerformanceMetrics, RuntimeSession, spawn_event_forwarder};
use crate::domain::runtime::{AppEvent, ProviderKind, RuntimeStatus};
use crate::infrastructure::codex::{ServerMessage, server_message_channel};

fn strip_transport_metadata(json: String) -> String {
    let mut event: Value = serde_json::from_str(&json).unwrap();
    event.as_object_mut().unwrap().remove("streamId");
    event.as_object_mut().unwrap().remove("deliveryId");
    serde_json::to_string(&event).unwrap()
}

#[test]
fn runtime_status_should_advance_monotonic_sequence() {
    let mut runtime = RuntimeSession::default();

    let starting = runtime.transition(RuntimeStatus::Starting, Some(ProviderKind::Codex));
    let ready = runtime.transition(RuntimeStatus::Ready, Some(ProviderKind::Codex));
    let AppEvent::RuntimeStatus {
        seq: starting_seq, ..
    } = starting
    else {
        panic!("starting event should contain runtime status");
    };
    let AppEvent::RuntimeStatus { seq: ready_seq, .. } = ready else {
        panic!("ready event should contain runtime status");
    };

    assert_eq!(starting_seq, 1);
    assert_eq!(ready_seq, 2);
    assert_eq!(runtime.snapshot.status, RuntimeStatus::Ready);
    assert_eq!(runtime.snapshot.provider, Some(ProviderKind::Codex));
    assert_eq!(runtime.snapshot.last_seq, 2);
}

#[test]
fn runtime_restart_should_use_bounded_backoff_and_reset_after_stable_uptime() {
    assert_eq!(
        runtime_restart_plan(0, Duration::ZERO),
        (1, Duration::from_secs(1))
    );
    assert_eq!(
        runtime_restart_plan(1, Duration::ZERO),
        (2, Duration::from_secs(2))
    );
    assert_eq!(
        runtime_restart_plan(5, Duration::ZERO),
        (6, Duration::from_secs(30))
    );
    assert_eq!(
        runtime_restart_plan(20, Duration::ZERO),
        (21, Duration::from_secs(30))
    );
    assert_eq!(
        runtime_restart_plan(5, Duration::from_secs(60)),
        (1, Duration::from_secs(1))
    );
}

#[tokio::test]
async fn closed_app_server_stream_should_mark_runtime_failed() {
    let runtime = Arc::new(Mutex::new(RuntimeSession::default()));
    {
        let mut session = runtime.lock().await;
        session.snapshot.status = RuntimeStatus::Ready;
        session.snapshot.provider = Some(ProviderKind::Codex);
    }
    let (sender, receiver) = server_message_channel(1);
    let task = spawn_event_forwarder(Arc::clone(&runtime), receiver, None);
    drop(sender);
    task.await.expect("event forwarder should stop cleanly");

    let session = runtime.lock().await;
    assert_eq!(session.snapshot.status, RuntimeStatus::Failed);
    assert!(session.codex_process.is_none());
}

#[tokio::test]
async fn task_scoped_mcp_status_should_be_forwarded() {
    let published = Arc::new(StdMutex::new(Vec::new()));
    let published_for_channel = Arc::clone(&published);
    let channel = Channel::new(move |body| {
        if let InvokeResponseBody::Json(value) = body {
            published_for_channel
                .lock()
                .unwrap()
                .push(strip_transport_metadata(value));
        }
        Ok(())
    });
    let runtime = Arc::new(Mutex::new(RuntimeSession::default()));
    {
        let mut session = runtime.lock().await;
        session.set_event_channel(channel);
        session
            .task_projects
            .insert("thread-a".to_owned(), "project-a".to_owned());
    }
    let (sender, receiver) = server_message_channel(1);
    let task = spawn_event_forwarder(Arc::clone(&runtime), receiver, None);
    sender
        .send(ServerMessage {
            id: None,
            method: "mcpServer/startupStatus/updated".to_owned(),
            params: to_raw_value(&json!({
                "threadId": "thread-a",
                "name": "context7",
                "status": "ready",
                "error": null,
                "failureReason": null
            }))
            .unwrap(),
        })
        .await
        .unwrap();
    drop(sender);
    task.await.expect("event forwarder should stop cleanly");

    let events = published.lock().unwrap();
    let agent_event = events
        .iter()
        .filter_map(|event| serde_json::from_str::<Value>(event).ok())
        .find(|event| {
            event.pointer("/data/event/type").and_then(Value::as_str)
                == Some("mcp_server.status_updated")
        })
        .expect("task-scoped MCP status should be published");
    assert_eq!(agent_event["data"]["event"]["taskId"], "thread-a");
}

#[tokio::test]
async fn dropped_delta_signal_should_request_project_resync() {
    let published = Arc::new(StdMutex::new(Vec::new()));
    let published_for_channel = Arc::clone(&published);
    let channel = Channel::new(move |body| {
        if let InvokeResponseBody::Json(value) = body {
            published_for_channel
                .lock()
                .unwrap()
                .push(strip_transport_metadata(value));
        }
        Ok(())
    });
    let runtime = Arc::new(Mutex::new(RuntimeSession::default()));
    {
        let mut session = runtime.lock().await;
        session.set_event_channel(channel);
        session
            .task_projects
            .insert("thread-a".to_owned(), "project-a".to_owned());
        session.project_sequences.insert("project-a".to_owned(), 17);
    }
    let (sender, receiver) = server_message_channel(1);
    let task = spawn_event_forwarder(Arc::clone(&runtime), receiver, None);
    sender
        .send(ServerMessage {
            id: None,
            method: "codeagent/eventRetentionExceeded".to_owned(),
            params: to_raw_value(&json!({"threadId": "thread-a"})).unwrap(),
        })
        .await
        .unwrap();
    drop(sender);
    task.await.expect("event forwarder should stop cleanly");

    let events = published.lock().unwrap();
    let resync = events
        .iter()
        .filter_map(|event| serde_json::from_str::<Value>(event).ok())
        .find(|event| event.get("type").and_then(Value::as_str) == Some("resyncRequired"))
        .expect("dropped delta should publish an explicit resync signal");
    assert_eq!(
        resync,
        json!({
            "data": {
                "latestSequence": 17,
                "projectId": "project-a",
                "reason": "event_retention_exceeded",
                "sessionId": "codeagent-runtime",
                "type": "resync.required",
                "version": 3
            },
            "type": "resyncRequired"
        })
    );
}

#[tokio::test]
async fn event_channel_should_run_without_holding_runtime_lock() {
    let runtime = Arc::new(Mutex::new(RuntimeSession::default()));
    let runtime_for_channel = Arc::clone(&runtime);
    let lock_was_available = Arc::new(AtomicBool::new(false));
    let lock_was_available_for_channel = Arc::clone(&lock_was_available);
    let channel = Channel::new(move |body| {
        if let InvokeResponseBody::Json(value) = body
            && serde_json::from_str::<Value>(&value)
                .ok()
                .and_then(|event| event.pointer("/data/event/type").cloned())
                == Some(json!("mcp_server.status_updated"))
        {
            lock_was_available_for_channel
                .store(runtime_for_channel.try_lock().is_ok(), Ordering::Relaxed);
        }
        Ok(())
    });
    {
        let mut session = runtime.lock().await;
        session.set_event_channel(channel);
        session
            .task_projects
            .insert("thread-a".to_owned(), "project-a".to_owned());
    }
    let (sender, receiver) = server_message_channel(1);
    let task = spawn_event_forwarder(Arc::clone(&runtime), receiver, None);
    sender
        .send(ServerMessage {
            id: None,
            method: "mcpServer/startupStatus/updated".to_owned(),
            params: to_raw_value(&json!({
                "threadId": "thread-a",
                "name": "context7",
                "status": "ready"
            }))
            .unwrap(),
        })
        .await
        .unwrap();
    drop(sender);
    task.await.expect("event forwarder should stop cleanly");

    assert!(
        lock_was_available.load(Ordering::Relaxed),
        "runtime lock should be released before Channel::send"
    );
}

#[tokio::test]
async fn missing_webview_channel_should_not_stop_event_forwarder() {
    let runtime = Arc::new(Mutex::new(RuntimeSession::default()));
    {
        let mut session = runtime.lock().await;
        session.snapshot.status = RuntimeStatus::Ready;
        session.snapshot.provider = Some(ProviderKind::Codex);
        session
            .task_projects
            .insert("thread-a".to_owned(), "project-a".to_owned());
    }
    let (sender, receiver) = server_message_channel(2);
    let task = spawn_event_forwarder(Arc::clone(&runtime), receiver, None);
    for name in ["context7", "filesystem"] {
        sender
            .send(ServerMessage {
                id: None,
                method: "mcpServer/startupStatus/updated".to_owned(),
                params: to_raw_value(&json!({
                    "threadId": "thread-a",
                    "name": name,
                    "status": "ready"
                }))
                .unwrap(),
            })
            .await
            .unwrap();
    }
    timeout(Duration::from_millis(100), async {
        loop {
            if runtime.lock().await.project_sequences.get("project-a") == Some(&2) {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("event forwarder should keep consuming without a WebView channel");
    assert!(!task.is_finished());

    drop(sender);
    task.await.expect("event forwarder should stop cleanly");
}

#[tokio::test]
async fn consecutive_deltas_should_merge_before_crossing_the_channel() {
    let published = Arc::new(StdMutex::new(Vec::new()));
    let published_for_channel = Arc::clone(&published);
    let channel = Channel::new(move |body| {
        if let InvokeResponseBody::Json(value) = body {
            published_for_channel
                .lock()
                .unwrap()
                .push(strip_transport_metadata(value));
        }
        Ok(())
    });
    let runtime = Arc::new(Mutex::new(RuntimeSession::default()));
    {
        let mut session = runtime.lock().await;
        session.set_event_channel(channel);
        session
            .task_projects
            .insert("thread-a".to_owned(), "project-a".to_owned());
    }
    let (sender, receiver) = server_message_channel(4);
    let task = spawn_event_forwarder(Arc::clone(&runtime), receiver, None);
    for delta in ["a", "b", "c"] {
        sender
            .send(ServerMessage {
                id: None,
                method: "item/agentMessage/delta".to_owned(),
                params: to_raw_value(&json!({
                    "threadId": "thread-a",
                    "turnId": "turn-a",
                    "itemId": "item-a",
                    "delta": delta
                }))
                .unwrap(),
            })
            .await
            .unwrap();
    }
    drop(sender);
    task.await.expect("event forwarder should stop cleanly");
    timeout(Duration::from_millis(100), async {
        while published.lock().unwrap().len() < 3 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("channel should receive merged events");

    let events = published
        .lock()
        .unwrap()
        .iter()
        .filter_map(|event| serde_json::from_str::<Value>(event).ok())
        .filter(|event| {
            event.pointer("/data/event/type").and_then(Value::as_str) == Some("message.delta")
        })
        .collect::<Vec<_>>();
    assert_eq!(events.len(), 2);
    assert_eq!(events[0]["data"]["event"]["payload"]["delta"], "a");
    assert_eq!(events[0]["data"]["event"]["sequence"], 1);
    assert_eq!(events[1]["data"]["event"]["payload"]["delta"], "bc");
    assert_eq!(events[1]["data"]["event"]["sequence"], 2);
}

#[test]
fn runtime_performance_metrics_should_report_merge_rate_and_queue_high_watermark() {
    let mut metrics = RuntimePerformanceMetrics::default();
    metrics.record_delivery("project-a", 10, 4, 7);

    let snapshot = metrics.snapshot();
    let project = &snapshot.projects[0];
    assert_eq!(project.project_id, "project-a");
    assert_eq!(project.provider_events_received, 10);
    assert_eq!(project.published_events, 4);
    assert_eq!(project.coalesced_events, 6);
    assert_eq!(project.ipc_events_per_second, 4.0);
    assert_eq!(project.merge_rate, 0.6);
    assert_eq!(project.queue_high_watermark, 7);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn saturated_event_channel_should_preserve_native_progress_and_report_resync() {
    let published = Arc::new(StdMutex::new(Vec::new()));
    let published_for_channel = Arc::clone(&published);
    let channel = Channel::new(move |body| {
        if let InvokeResponseBody::Json(value) = body {
            published_for_channel
                .lock()
                .unwrap()
                .push(strip_transport_metadata(value));
        }
        Ok(())
    });
    let runtime = Arc::new(Mutex::new(RuntimeSession::default()));
    {
        let mut session = runtime.lock().await;
        session.set_event_channel(channel);
        session
            .task_projects
            .insert("thread-a".to_owned(), "project-a".to_owned());
    }
    let (sender, receiver) = server_message_channel(300);
    let task = spawn_event_forwarder(Arc::clone(&runtime), receiver, None);
    for index in 0..300 {
        sender
            .send(ServerMessage {
                id: None,
                method: "mcpServer/startupStatus/updated".to_owned(),
                params: to_raw_value(&json!({
                    "threadId": "thread-a",
                    "name": format!("server-{index}"),
                    "status": "ready"
                }))
                .unwrap(),
            })
            .await
            .unwrap();
    }
    drop(sender);

    // 模拟多轮渲染后 WebView 暂时消费不过来的情况，并等待后端完成全部 Sequence 分配。
    let _ = timeout(Duration::from_millis(500), async {
        loop {
            if runtime.lock().await.project_sequences.get("project-a") == Some(&300) {
                break;
            }
            sleep(Duration::from_millis(1)).await;
        }
    })
    .await;
    task.await.expect("event forwarder should stop cleanly");

    let sequences = published
        .lock()
        .unwrap()
        .iter()
        .filter_map(|event| serde_json::from_str::<Value>(event).ok())
        .filter_map(|event| {
            event
                .pointer("/data/event/sequence")
                .and_then(Value::as_u64)
        })
        .collect::<Vec<_>>();
    assert!(sequences.len() <= 56);
    assert_eq!(runtime.lock().await.project_sequences["project-a"], 300);
    assert!(
        published
            .lock()
            .unwrap()
            .iter()
            .any(|body| body.contains("resyncRequired"))
    );
}
#[tokio::test]
async fn task_window_receives_output_without_main_channel_and_prevents_early_unsubscribe() {
    use super::{AppState, prepare_event_delivery};
    use crate::application::task_window_stream::TaskWindowProjection;
    let state = AppState::default();
    let windows = state.task_windows().await;
    let (label, _) = windows.reserve("project-a", "task-a").unwrap();
    windows.initialize(&label, TaskWindowProjection::default());
    let packets = Arc::new(StdMutex::new(Vec::new()));
    let received = Arc::clone(&packets);
    windows
        .connect(
            &label,
            Channel::new(move |body| {
                if let InvokeResponseBody::Json(value) = body {
                    received.lock().unwrap().push(value);
                }
                Ok(())
            }),
        )
        .unwrap();
    windows.acknowledge(&label, 1).unwrap();
    assert!(state.runtime.lock().await.event_sender.is_none());
    prepare_event_delivery(&state.runtime).await.send(AppEvent::AgentEvent {
        event: json!({"type":"message.delta", "taskId":"task-a", "itemId":"item-a", "payload":{"delta":"live without main"}}).into(),
    }).await;
    assert_eq!(packets.lock().unwrap().len(), 2);
    let packet: Value = serde_json::from_str(&packets.lock().unwrap()[1]).unwrap();
    assert_eq!(packet["updates"][0]["text"], "live without main");
    let release = state.release_task_subscription("task-a").await;
    assert!(
        !state
            .is_task_subscription_release_current("task-a", release)
            .await
    );
    windows.remove(&label);
    let closed = state.release_task_subscription("task-a").await;
    assert!(
        state
            .is_task_subscription_release_current("task-a", closed)
            .await
    );
}
