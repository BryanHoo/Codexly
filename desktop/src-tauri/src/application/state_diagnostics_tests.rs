use super::*;
use serde_json::json;

#[tokio::test]
async fn diagnostic_task_failure_keeps_scope_and_reason_without_content() {
    let capture = crate::infrastructure::diagnostics::test_support::Capture::start();
    let runtime = Arc::new(Mutex::new(RuntimeSession::default()));
    runtime
        .lock()
        .await
        .task_projects
        .insert("private-task".to_owned(), "private-project".to_owned());
    let event = json!({"type":"turn.completed","taskId":"private-task","turnId":"private-turn", "payload":{"turn":{"status":"failed","error":"connection reset","items":[{"text":"private prompt"}]}}});
    super::event_publisher::publish_mapped_event(&runtime, event.into(), None).await;
    let events = capture.take();
    let failed = events
        .iter()
        .find(|event| event["event"] == "agent_turn_completed")
        .unwrap();
    assert_eq!(failed["level"], json!("error"));
    assert_eq!(failed["message"], json!("connection reset"));
    assert!(failed["context"]["taskId"].is_string());
    assert!(!serde_json::to_string(failed).unwrap().contains("private"));
}
