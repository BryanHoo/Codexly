use std::sync::{Arc, Mutex};

use serde_json::{Value, json};
use tauri::ipc::{Channel, InvokeResponseBody};

use super::RuntimeSession;
use crate::domain::runtime::AppEvent;

#[tokio::test]
async fn publication_boundary_should_confirm_only_after_native_delivery() {
    use std::sync::atomic::{AtomicBool, Ordering};
    let delivered = Arc::new(AtomicBool::new(false));
    let output = Arc::clone(&delivered);
    let mut session = RuntimeSession::default();
    session
        .task_projects
        .insert("task".to_owned(), "project".to_owned());
    session.set_event_channel(Channel::new(move |_| {
        output.store(true, Ordering::SeqCst);
        Ok(())
    }));
    let runtime = Arc::new(tokio::sync::Mutex::new(session));
    let confirmed = AtomicBool::new(false);
    super::event_publisher::publish_mapped_event_at_boundary(&runtime,
        json!({"type":"message.delta","taskId":"task","turnId":"turn","itemId":"item","payload":{"delta":"text"}}).into(), None, || {
            assert!(delivered.load(Ordering::SeqCst));
            confirmed.store(true, Ordering::SeqCst);
        }).await;
    assert!(confirmed.load(Ordering::SeqCst));
}

#[tokio::test]
async fn slow_webview_should_bound_unacknowledged_bytes() {
    let received = Arc::new(Mutex::new(Vec::new()));
    let output = Arc::clone(&received);
    let mut session = RuntimeSession::default();
    session.set_event_channel(Channel::new(move |body| {
        if let InvokeResponseBody::Json(body) = body {
            output.lock().unwrap().push(body);
        }
        Ok(())
    }));
    let sender = session.event_sender.as_ref().unwrap();
    for sequence in 1..=2_000 {
        sender.publish(AppEvent::AgentEvent {
            event: json!({"type":"command.output_delta", "sequence":sequence,
                "taskId":"task-a", "payload":{"delta":"x".repeat(16_384)}})
            .into(),
        });
    }
    let stats = sender.snapshot();
    assert!(stats.in_flight_bytes <= 1_048_576);
    assert!(stats.queued_bytes <= 4 * 1_048_576);
    let messages = received.lock().unwrap();
    assert!(messages.iter().map(String::len).sum::<usize>() <= 1_048_576);
    assert!(
        messages.iter().any(|body| {
            serde_json::from_str::<Value>(body).unwrap()["type"] == "resyncRequired"
        })
    );
}

#[test]
fn acknowledgements_should_release_only_real_packets_and_reject_stale_generations() {
    let received = Arc::new(Mutex::new(Vec::new()));
    let output = Arc::clone(&received);
    let mut session = RuntimeSession::default();
    session.set_event_channel(Channel::new(move |body| {
        if let InvokeResponseBody::Json(body) = body {
            output.lock().unwrap().push(body);
        }
        Ok(())
    }));
    let stream = session.event_sender.as_ref().unwrap();
    for sequence in 0..100 {
        stream.publish(AppEvent::AgentEvent {
            event: json!({"sequence":sequence,"type":"message.delta"}).into(),
        });
    }
    assert_eq!(received.lock().unwrap().len(), 56);
    let before = stream.snapshot().in_flight_bytes;
    stream.acknowledge(0, &[1]);
    stream.acknowledge(1, &[1_000]);
    assert_eq!(stream.snapshot().in_flight_bytes, before);
    stream.acknowledge(1, &[1, 1]);
    assert_eq!(received.lock().unwrap().len(), 57);
    for id in 2..=100 {
        stream.acknowledge(1, &[id]);
    }
    assert_eq!(stream.snapshot().in_flight_bytes, 0);
    assert_eq!(stream.snapshot().queued_bytes, 0);
    let old = Arc::clone(stream);
    session.set_event_channel(Channel::new(|_| Ok(())));
    old.publish(AppEvent::AgentEvent {
        event: json!({"type":"message.delta"}).into(),
    });
    assert_eq!(received.lock().unwrap().len(), 100);
}

#[test]
fn stream_packet_should_include_enqueue_timestamp() {
    let received = Arc::new(Mutex::new(Vec::new()));
    let output = Arc::clone(&received);
    let mut session = RuntimeSession::default();
    session.set_event_channel(Channel::new(move |body| {
        if let InvokeResponseBody::Json(body) = body {
            output.lock().unwrap().push(body);
        }
        Ok(())
    }));
    let before = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64;
    session
        .event_sender
        .as_ref()
        .unwrap()
        .publish(AppEvent::AgentEvent {
            event: json!({"sequence":1,"type":"message.delta"}).into(),
        });
    let after = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64;
    let packet: Value = serde_json::from_str(&received.lock().unwrap()[0]).unwrap();
    assert!((before..=after).contains(&packet["enqueuedAtUnixMs"].as_u64().unwrap()));
}
