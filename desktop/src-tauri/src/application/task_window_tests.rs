use serde_json::json;

use super::task_window_runtime::TaskWindowRuntime;
use super::task_window_stream::{MAX_ROWS, MAX_TEXT_BYTES, TaskWindowProjection};

fn event(kind: &str, payload: serde_json::Value) -> crate::domain::runtime::AgentEvent {
    json!({"type": kind, "taskId": "task-a", "turnId": "turn-a", "itemId": "item-a", "payload": payload}).into()
}

#[test]
fn task_window_stream_sends_only_new_text_and_replaces_completed_items() {
    let mut view = TaskWindowProjection::default();
    view.apply(&event(
        "item.started",
        json!({"item": {"id":"item-a", "type":"message", "role":"assistant", "text":"Hello"}}),
    ));
    let first = view.packet(1, true).unwrap();
    assert_eq!(first.updates[0].row.text, "Hello");
    view.apply(&event("message.delta", json!({"delta":" world"})));
    let next = view.packet(2, false).unwrap();
    assert!(next.updates[0].append);
    assert_eq!(next.updates[0].row.text, " world");
    view.apply(&event(
        "item.completed",
        json!({"item": {"id":"item-a", "type":"message", "role":"assistant", "text":"Corrected"}}),
    ));
    let corrected = view.packet(3, false).unwrap();
    assert!(!corrected.updates[0].append);
    assert_eq!(corrected.updates[0].row.text, "Corrected");
    assert!(view.packet(4, false).is_none());
}

#[test]
fn task_window_operations_send_compact_titles_without_internal_output() {
    let mut view = TaskWindowProjection::default();
    for kind in ["command", "tool", "file_change"] {
        let title = format!("执行 {}", "检查\n".repeat(1000));
        view.item(
            &json!({"id":kind, "type":kind, "command":title, "name":title,
            "changes":[{"path":title, "diff":"PRIVATE DIFF"}], "output":"PRIVATE OUTPUT"}),
        );
    }
    let packet = view.packet(1, true).unwrap();
    assert_eq!(packet.updates.len(), 3);
    for update in packet.updates {
        assert!(update.row.text.chars().count() <= 160);
        assert!(update.row.text.starts_with("执行"));
        assert!(!update.row.text.contains('\n'));
        assert!(!update.row.text.contains("PRIVATE"));
    }
}

#[test]
fn task_window_stream_bounds_unicode_text_and_row_count() {
    let mut view = TaskWindowProjection::default();
    for index in 0..100 {
        view.apply(&event("item.completed", json!({"item": {"id":format!("item-{index}"), "type":"message", "role":"assistant", "text":"你好🌍".repeat(5000)}})));
    }
    let packet = view.packet(1, true).unwrap();
    assert!(packet.order.len() <= MAX_ROWS);
    assert!(
        packet
            .updates
            .iter()
            .all(|row| row.row.text.len() <= MAX_TEXT_BYTES)
    );
    assert!(
        packet
            .updates
            .iter()
            .all(|row| row.row.text.ends_with("你好🌍"))
    );
}

#[test]
fn task_window_stream_new_turn_discards_previous_turn_and_user_input() {
    let mut view = TaskWindowProjection::default();
    view.apply(&event(
        "item.completed",
        json!({"item": {"id":"item-a", "type":"message", "role":"assistant", "text":"old"}}),
    ));
    view.packet(1, true).unwrap();
    view.apply(&event("turn.started", json!({"turn":{"id":"turn-b"}})));
    view.apply(&event(
        "item.completed",
        json!({"item": {"id":"user-a", "type":"message", "role":"user", "text":"private prompt"}}),
    ));
    let packet = view.packet(2, false).unwrap();
    assert!(packet.order.is_empty());
    assert_eq!(packet.status, "running");
}

#[test]
fn task_window_capacity_deduplicates_and_reclaims_closed_slots() {
    let runtime = TaskWindowRuntime::default();
    let (first, created) = runtime.reserve("project-a", "task-a").unwrap();
    assert!(created);
    assert_eq!(
        runtime.reserve("project-a", "task-a").unwrap(),
        (first.clone(), false)
    );
    runtime.reserve("project-a", "task-b").unwrap();
    runtime.reserve("project-a", "task-c").unwrap();
    assert!(runtime.reserve("project-a", "task-d").is_err());
    runtime.remove(&first).unwrap();
    assert!(runtime.reserve("project-a", "task-d").is_ok());
}

#[test]
fn task_window_scope_rejects_route_injection_and_handles_temporary_tasks() {
    let runtime = TaskWindowRuntime::default();
    assert!(runtime.reserve("../project", "task").is_err());
    assert!(runtime.reserve("project", "task?window=main").is_err());
    let (label, _) = runtime.reserve("temporary", "task-a").unwrap();
    assert_eq!(runtime.route(&label).unwrap(), "temporary/t/task-a");
    assert!(runtime.route("main").is_err());
}

#[test]
fn task_window_backpressure_keeps_one_packet_and_coalesces_until_acknowledged() {
    use std::sync::{Arc, Mutex};
    use tauri::ipc::{Channel, InvokeResponseBody};
    let runtime = TaskWindowRuntime::default();
    let (label, _) = runtime.reserve("project-a", "task-a").unwrap();
    runtime.initialize(&label, TaskWindowProjection::default());
    let packets = Arc::new(Mutex::new(Vec::new()));
    let received = Arc::clone(&packets);
    runtime
        .connect(
            &label,
            Channel::new(move |body| {
                if let InvokeResponseBody::Json(value) = body {
                    received
                        .lock()
                        .unwrap()
                        .push(serde_json::from_str::<serde_json::Value>(&value).unwrap());
                }
                Ok(())
            }),
        )
        .unwrap();
    for _ in 0..1000 {
        runtime.observe(&crate::domain::runtime::AppEvent::AgentEvent {
            event: event("message.delta", json!({"delta":"x"})),
        });
    }
    assert_eq!(packets.lock().unwrap().len(), 1);
    runtime.acknowledge(&label, 999).unwrap();
    assert_eq!(packets.lock().unwrap().len(), 1);
    runtime.acknowledge(&label, 1).unwrap();
    assert_eq!(packets.lock().unwrap().len(), 2);
    assert_eq!(
        packets.lock().unwrap()[1]["updates"][0]["text"],
        "x".repeat(1000)
    );
    runtime.remove(&label);
    assert!(!runtime.contains_task("task-a"));
    assert!(runtime.acknowledge(&label, 2).is_err());
}

#[test]
fn task_window_bootstrap_preserves_events_arriving_during_snapshot_read() {
    use std::sync::{Arc, Mutex};
    use tauri::ipc::{Channel, InvokeResponseBody};
    let runtime = TaskWindowRuntime::default();
    let (label, _) = runtime.reserve("project-a", "task-a").unwrap();
    runtime.observe(&crate::domain::runtime::AppEvent::AgentEvent {
        event: event("turn.started", json!({"turn":{"id":"turn-new"}})),
    });
    runtime.observe(&crate::domain::runtime::AppEvent::AgentEvent {
        event: event("message.delta", json!({"delta":"new live output"})),
    });
    let mut old = TaskWindowProjection::default();
    old.item(&json!({"id":"old", "type":"message", "role":"assistant", "text":"old turn"}));
    old.set_status("completed");
    runtime.initialize(&label, old);
    let packets = Arc::new(Mutex::new(Vec::new()));
    let received = Arc::clone(&packets);
    runtime
        .connect(
            &label,
            Channel::new(move |body| {
                if let InvokeResponseBody::Json(value) = body {
                    received
                        .lock()
                        .unwrap()
                        .push(serde_json::from_str::<serde_json::Value>(&value).unwrap());
                }
                Ok(())
            }),
        )
        .unwrap();
    let packet = packets.lock().unwrap();
    assert_eq!(packet[0]["status"], "running");
    assert_eq!(packet[0]["order"], json!(["item-a"]));
    assert_eq!(packet[0]["updates"][0]["text"], "new live output");
}
