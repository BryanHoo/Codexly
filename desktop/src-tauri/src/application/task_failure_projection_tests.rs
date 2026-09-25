use super::{MAX_BYTES, MAX_ENTRY_BYTES, MAX_TASKS, TaskFailureProjection};
use crate::domain::runtime::AgentEvent;
use serde_json::{Value, json};

fn observe(
    cache: &mut TaskFailureProjection,
    project: &str,
    task: &str,
    turn: &str,
    kind: &str,
    payload: Value,
) -> Value {
    let mut event =
        AgentEvent::from(json!({"type":kind,"taskId":task,"turnId":turn,"payload":payload}));
    cache.observe(project, &mut event);
    event.as_json().unwrap().clone()
}

fn fail(cache: &mut TaskFailureProjection, task: &str, message: &str) {
    observe(
        cache,
        "project",
        task,
        "turn",
        "provider.error",
        json!({"message":message,"willRetry":false}),
    );
}

fn complete(
    cache: &mut TaskFailureProjection,
    project: &str,
    task: &str,
    turn: &str,
    status: &str,
    error: Value,
) -> Value {
    observe(
        cache,
        project,
        task,
        turn,
        "turn.completed",
        json!({"turn":{"id":turn,"status":status,"error":error,"items":[]}}),
    )["payload"]["turn"]["error"]
        .clone()
}

#[test]
fn failure_projection_enriches_only_matching_failed_terminal_events() {
    let mut cache = TaskFailureProjection::default();
    fail(&mut cache, "task", "original failure");
    assert_eq!(
        complete(&mut cache, "other", "task", "turn", "failed", Value::Null),
        Value::Null
    );
    assert_eq!(
        complete(
            &mut cache,
            "project",
            "other",
            "turn",
            "failed",
            Value::Null
        ),
        Value::Null
    );
    assert_eq!(
        complete(
            &mut cache,
            "project",
            "task",
            "other",
            "failed",
            Value::Null
        ),
        Value::Null
    );
    assert_eq!(
        complete(&mut cache, "project", "task", "turn", "failed", Value::Null),
        "original failure"
    );
    assert_eq!(
        complete(
            &mut cache,
            "project",
            "task",
            "turn",
            "failed",
            json!("terminal failure")
        ),
        "terminal failure"
    );
    assert_eq!(cache.failures["task"].message, "terminal failure");
    assert_eq!(
        complete(
            &mut cache,
            "project",
            "task",
            "turn",
            "completed",
            Value::Null
        ),
        Value::Null
    );
    assert!(cache.failures.is_empty());
}

#[test]
fn failure_projection_retries_and_new_turns_do_not_inherit_stale_errors() {
    let mut cache = TaskFailureProjection::default();
    fail(&mut cache, "task", "old failure");
    observe(
        &mut cache,
        "project",
        "task",
        "turn",
        "turn.started",
        json!({}),
    );
    assert_eq!(cache.failures["task"].message, "old failure");
    observe(
        &mut cache,
        "project",
        "task",
        "turn",
        "provider.error",
        json!({"message":"retrying","willRetry":true}),
    );
    assert_eq!(
        complete(&mut cache, "project", "task", "turn", "failed", Value::Null),
        Value::Null
    );
    fail(&mut cache, "task", "old failure");
    observe(
        &mut cache,
        "project",
        "task",
        "new-turn",
        "turn.started",
        json!({}),
    );
    assert!(cache.failures.is_empty());
}

#[test]
fn failure_projection_retention_obeys_count_and_string_budgets() {
    let mut cache = TaskFailureProjection::default();
    for index in 0..=MAX_TASKS {
        fail(&mut cache, &format!("task-{index}"), "failure");
    }
    assert_eq!(cache.failures.len(), MAX_TASKS);
    assert!(!cache.failures.contains_key("task-0"));
    for index in 0..32 {
        fail(&mut cache, &format!("large-{index}"), &"x".repeat(60_000));
        assert!(cache.bytes <= MAX_BYTES);
    }
    assert!(cache.failures.len() < 32);
    fail(&mut cache, "large-31", &"x".repeat(MAX_ENTRY_BYTES));
    assert!(!cache.failures.contains_key("large-31"));
    assert_eq!(
        cache.bytes,
        cache
            .failures
            .values()
            .map(|failure| failure.bytes)
            .sum::<usize>()
    );
}

#[test]
fn failure_projection_releases_removed_tasks_projects_and_runtime() {
    let mut cache = TaskFailureProjection::default();
    fail(&mut cache, "task", "failure");
    cache.forget_project("other");
    assert_eq!(cache.failures.len(), 1);
    observe(
        &mut cache,
        "project",
        "task",
        "turn",
        "task.removed",
        json!({}),
    );
    assert_eq!(cache.bytes, 0);
    fail(&mut cache, "task", "failure");
    cache.forget_project("project");
    assert_eq!(cache.bytes, 0);
    fail(&mut cache, "task", "failure");
    cache.clear();
    assert_eq!(cache.bytes, 0);
    assert!(cache.failures.is_empty());
}
