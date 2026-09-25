use super::*;

#[test]
fn diagnostic_runtime_transitions_and_restart_include_recovery_context() {
    let capture = crate::infrastructure::diagnostics::test_support::Capture::start();
    let mut runtime = RuntimeSession::default();
    runtime.transition(RuntimeStatus::Starting, Some(ProviderKind::Codex));
    runtime.transition(RuntimeStatus::Failed, Some(ProviderKind::Codex));
    super::runtime_supervisor::prepare_runtime_restart(&mut runtime);
    let events = capture.take();
    let failed = events
        .iter()
        .find(|event| {
            event["event"] == "codex_runtime_transition" && event["context"]["status"] == "failed"
        })
        .unwrap();
    assert_eq!(failed["context"]["previousStatus"], json!("starting"));
    let restart = events
        .iter()
        .find(|event| event["event"] == "codex_runtime_restart_scheduled")
        .unwrap();
    assert_eq!(restart["context"]["restartAttempt"], json!(1));
    assert_eq!(restart["context"]["delayMs"], json!(1000));
}

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
    super::event_publisher::publish_mapped_event(&runtime, event.into(), None, None).await;
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
