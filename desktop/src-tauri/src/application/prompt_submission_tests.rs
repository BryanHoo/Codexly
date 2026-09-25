use super::*;
use crate::domain::sidebar::AgentTaskMutationResponse;
use serde_json::json;
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};

fn task() -> AgentTask {
    AgentTask {
        id: "task-a".into(),
        project_id: "project-a".into(),
        title: "Task".into(),
        pinned: false,
        updated_at: "2026-09-13T00:00:00Z".into(),
    }
}

#[test]
fn prompt_submission_should_bound_inputs_waiting_for_creation_and_release_capacity() {
    let budget = SubmissionBudget::default();
    let first = budget.reserve(4 * 1024 * 1024).unwrap();
    let second = budget.reserve(4 * 1024 * 1024).unwrap();
    assert!(budget.reserve(1).is_err());
    drop(first);
    assert!(budget.reserve(1).is_ok());
    drop(second);
    // 字节申请失败不能泄漏请求许可；小输入也受请求数量上限保护。
    let permits: Vec<_> = (0..16).map(|_| budget.reserve(1).unwrap()).collect();
    assert!(budget.reserve(1).is_err());
    drop(permits);
    assert!(budget.reserve(1).is_ok());
}

#[tokio::test]
async fn prompt_submission_should_publish_created_task_before_start_and_preserve_it_on_failure() {
    let notified = Arc::new(AtomicBool::new(false));
    let observed = Arc::clone(&notified);
    let response = submit(
        None,
        async { Ok(AgentTaskMutationResponse { task: task() }) },
        move |created| {
            assert_eq!(created.id, "task-a");
            notified.store(true, Ordering::SeqCst);
        },
        move |id| async move {
            assert!(observed.load(Ordering::SeqCst));
            assert_eq!(id, "task-a");
            Err(json!({"code": "TURN_START_UNCERTAIN", "message": "unknown"}))
        },
    )
    .await
    .unwrap();
    assert_eq!(
        serde_json::to_value(response).unwrap(),
        json!({"createdTask": task(), "outcome": {"type": "failed", "error": {"code": "TURN_START_UNCERTAIN", "message": "unknown"}}})
    );
}

#[tokio::test]
async fn prompt_submission_should_not_start_after_creation_failure() {
    let error = submit(
        None,
        async { Err(json!("creation failed")) },
        |_| panic!("must not notify"),
        |_| async { panic!("must not start") },
    )
    .await
    .unwrap_err();
    assert_eq!(error, json!("creation failed"));
}

#[tokio::test]
async fn prompt_submission_should_skip_creation_for_existing_task() {
    let response = submit(
        Some("existing".into()),
        async { panic!("must not create") },
        |_| panic!("must not notify"),
        |id| async move {
            assert_eq!(id, "existing");
            Ok(json!({"taskId": id, "turn": {"id": "turn-a"}}))
        },
    )
    .await
    .unwrap();
    assert_eq!(
        serde_json::to_value(response).unwrap(),
        json!({"createdTask": null, "outcome": {"type": "started", "result": {"taskId": "existing", "turn": {"id": "turn-a"}}}})
    );
}

fn request(task_id: Option<&str>, task_key: Option<&str>, turn_key: &str) -> SubmissionRequest {
    SubmissionRequest {
        project_id: "project-a".into(),
        task_id: task_id.map(str::to_owned),
        input: AgentPromptInput::text("hello"),
        turn_options: AgentTurnOptions::default(),
        idempotency_keys: SubmissionKeys {
            start_task: task_key.map(str::to_owned),
            start_turn: turn_key.into(),
        },
    }
}

#[test]
fn prompt_submission_should_validate_keys_and_budget_before_creation() {
    for invalid in [
        request(None, None, "turn"),
        request(None, Some(" "), "turn"),
        request(None, Some("task"), ""),
        request(Some(""), None, "turn"),
    ] {
        assert_eq!(invalid.validate().unwrap_err()["code"], "INVALID_REQUEST");
    }
    let mut large = request(None, Some("task"), "turn");
    large.input.text = "x".repeat(4 * 1024 * 1024);
    assert_eq!(large.validate().unwrap_err()["code"], "INVALID_REQUEST");
    assert!(request(Some("existing"), None, "turn").validate().is_ok());
}

#[test]
fn goal_submission_should_reject_invalid_input_before_creation() {
    for (text, attachment, skill, code) in [
        (" \n\t".to_owned(), false, false, "GOAL_OBJECTIVE_REQUIRED"),
        ("x".repeat(4001), false, false, "GOAL_OBJECTIVE_TOO_LONG"),
        ("🦀".repeat(4001), false, false, "GOAL_OBJECTIVE_TOO_LONG"),
        (
            "目标".to_owned(),
            true,
            false,
            "GOAL_STRUCTURED_INPUT_UNSUPPORTED",
        ),
        (
            "目标".to_owned(),
            false,
            true,
            "GOAL_STRUCTURED_INPUT_UNSUPPORTED",
        ),
    ] {
        let mut request = request(None, Some("task"), "turn");
        request.turn_options.goal_mode = true;
        request.input.text = text;
        if attachment {
            request.input.attachments.push(json!({"id":"unresolved"}));
        }
        if skill {
            request
                .input
                .skills
                .push(json!({"id":"skill","name":"skill"}));
        }
        assert_eq!(request.validate().unwrap_err()["code"], code);
    }
}

#[test]
fn goal_submission_should_count_unicode_scalars_and_allow_ordinary_structured_prompts() {
    let mut request = request(None, Some("task"), "turn");
    request.turn_options.goal_mode = true;
    request.input.text = format!("  {}\n", "🦀".repeat(4000));
    assert!(request.validate().is_ok());
    request.turn_options.goal_mode = false;
    request.input.text = "x".repeat(4001);
    request.input.attachments.push(json!({"id":"image"}));
    assert!(request.validate().is_ok());
}

#[tokio::test]
async fn prompt_submission_should_reuse_both_native_registries_on_retry() {
    use super::super::{
        task_creation::TaskCreationRegistry,
        turn_start::{TurnStartRegistry, fingerprint},
    };
    use std::sync::atomic::AtomicUsize;
    let creates = Arc::new(AtomicUsize::new(0));
    let starts = Arc::new(AtomicUsize::new(0));
    let creations = TaskCreationRegistry::default();
    let turns = TurnStartRegistry::default();
    for _ in 0..2 {
        let creates = Arc::clone(&creates);
        let starts = Arc::clone(&starts);
        let response = submit(
            None,
            creations.run("project-a", "task-key", async move {
                creates.fetch_add(1, Ordering::SeqCst);
                Ok(AgentTaskMutationResponse { task: task() })
            }),
            |_| {},
            |id| {
                let identity = fingerprint(
                    "project-a",
                    &id,
                    &AgentPromptInput::text("hello"),
                    &AgentTurnOptions::default(),
                )
                .unwrap();
                turns.run("turn-key", identity, async move {
                    starts.fetch_add(1, Ordering::SeqCst);
                    Ok(json!({"taskId": id, "turn": {"id": "turn-a"}}))
                })
            },
        )
        .await
        .unwrap();
        assert_eq!(response.created_task.unwrap().id, "task-a");
    }
    assert_eq!(creates.load(Ordering::SeqCst), 1);
    assert_eq!(starts.load(Ordering::SeqCst), 1);
}
