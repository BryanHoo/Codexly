use serde_json::json;

use super::task_activity::{TaskActivityState, TaskActivityStatus, is_approval_request_type};
use crate::domain::runtime::AgentEvent;

fn event(value: serde_json::Value) -> AgentEvent {
    AgentEvent::from(value)
}

#[test]
fn rust_owns_the_complete_task_activity_lifecycle() {
    let mut state = TaskActivityState::default();
    state.remember_task("project-1", "task-1", "底层任务", Some("/workspace"));

    let changed = state.apply_event(
        "project-1",
        &event(json!({
            "payload": {"turn": {"status": "inProgress"}},
            "taskId": "task-1",
            "turnId": "turn-1",
            "type": "turn.started"
        })),
    );
    assert!(changed, "首次运行事件必须触发原生活动状态刷新");
    assert_eq!(state.snapshot()[0].status, TaskActivityStatus::Running);

    state.apply_event(
        "project-1",
        &event(json!({
            "payload": {"request": {"requestId": "request-1", "type": "command_approval"}},
            "taskId": "task-1",
            "turnId": "turn-1",
            "type": "pending_request.created"
        })),
    );
    assert_eq!(state.snapshot()[0].status, TaskActivityStatus::Waiting);

    state.apply_event(
        "project-1",
        &event(json!({
            "payload": {"title": "新的任务标题"},
            "taskId": "task-1",
            "type": "task.metadata_changed"
        })),
    );
    assert_eq!(state.snapshot()[0].task_name, "新的任务标题");

    state.apply_event(
        "project-1",
        &event(json!({
            "payload": {"turn": {"status": "completed"}},
            "taskId": "task-1",
            "turnId": "turn-1",
            "type": "turn.completed"
        })),
    );
    assert_eq!(state.snapshot()[0].status, TaskActivityStatus::Completed);
    assert!(state.snapshot().iter().all(|task| !matches!(
        task.status,
        TaskActivityStatus::Running | TaskActivityStatus::Waiting
    )));

    assert!(state.acknowledge("project-1", "task-1"));
    assert!(state.snapshot().is_empty());
}

#[test]
fn native_activity_distinguishes_approval_requests_and_preserves_turn_start_time() {
    let mut state = TaskActivityState::default();
    state.remember_task("project-1", "task-1", "审批任务", None);
    state.apply_event(
        "project-1",
        &event(json!({
            "payload": {
                "turn": {
                    "startedAt": "2026-09-02T08:00:00Z",
                    "status": "running"
                }
            },
            "taskId": "task-1",
            "timestamp": "2026-09-02T08:00:00Z",
            "type": "turn.started"
        })),
    );
    assert_eq!(
        state.snapshot()[0].started_at.as_deref(),
        Some("2026-09-02T08:00:00Z")
    );

    state.apply_event(
        "project-1",
        &event(json!({
            "payload": {"request": {"requestId": "input-1", "type": "user_input"}},
            "taskId": "task-1",
            "type": "pending_request.created"
        })),
    );
    assert_eq!(state.snapshot()[0].status, TaskActivityStatus::Waiting);
    assert!(!state.snapshot()[0].requires_approval);

    state.apply_event(
        "project-1",
        &event(json!({
            "payload": {
                "request": {"requestId": "approval-1", "type": "permissions_approval"}
            },
            "taskId": "task-1",
            "type": "pending_request.created"
        })),
    );
    assert!(state.snapshot()[0].requires_approval);

    state.apply_event(
        "project-1",
        &event(json!({
            "payload": {"request": {"requestId": "approval-1"}},
            "taskId": "task-1",
            "type": "pending_request.resolved"
        })),
    );
    assert_eq!(state.snapshot()[0].status, TaskActivityStatus::Waiting);
    assert!(!state.snapshot()[0].requires_approval);
}

#[test]
fn every_supported_approval_request_enters_the_approval_state() {
    for request_type in [
        "command_approval",
        "terminal_input_approval",
        "file_change_approval",
        "permissions_approval",
        "mcp_elicitation",
        "plugin_install_suggestion",
    ] {
        assert!(is_approval_request_type(request_type));
    }
    assert!(!is_approval_request_type("user_input"));
}

#[test]
fn viewed_task_completion_should_not_leave_a_pet_activity() {
    let mut state = TaskActivityState::default();
    state.remember_task("project-1", "task-1", "当前任务", None);
    state.apply_event(
        "project-1",
        &event(json!({
            "payload": {"turn": {"status": "inProgress"}},
            "taskId": "task-1",
            "turnId": "turn-1",
            "type": "turn.started"
        })),
    );

    let changed = state.apply_event_for_viewed_task(
        "project-1",
        &event(json!({
            "payload": {"turn": {"status": "completed"}},
            "taskId": "task-1",
            "turnId": "turn-1",
            "type": "turn.completed"
        })),
        true,
    );

    assert!(changed);
    assert!(state.snapshot().is_empty());
}

#[test]
fn first_running_status_event_should_trigger_native_activity_refresh() {
    let mut state = TaskActivityState::default();
    state.remember_task("project-1", "task-1", "首次运行任务", None);

    let changed = state.apply_event(
        "project-1",
        &event(json!({
            "payload": {"status": "running"},
            "taskId": "task-1",
            "timestamp": "2026-09-02T08:30:00Z",
            "type": "task.status_updated"
        })),
    );

    assert!(changed, "首次运行状态必须触发托盘和桌宠刷新");
    assert_eq!(state.snapshot()[0].status, TaskActivityStatus::Running);
    assert_eq!(
        state.snapshot()[0].started_at.as_deref(),
        Some("2026-09-02T08:30:00Z")
    );
}

#[test]
fn prompt_title_should_only_replace_the_new_chat_placeholder() {
    let mut state = TaskActivityState::default();
    state.remember_task("project-1", "task-1", "新聊天", None);

    assert!(state.promote_placeholder_title("project-1", "task-1", "修复后台标题"));
    assert_eq!(state.task_name("task-1"), Some("修复后台标题"));
    state.apply_event(
        "project-1",
        &event(json!({
            "payload": {"turn": {"status": "inProgress"}},
            "taskId": "task-1",
            "turnId": "turn-1",
            "type": "turn.started"
        })),
    );
    assert_eq!(state.snapshot()[0].task_name, "修复后台标题");
    assert!(!state.promote_placeholder_title("project-1", "task-1", "不要覆盖已有标题"));
    assert_eq!(state.task_name("task-1"), Some("修复后台标题"));
}

#[test]
fn runtime_failure_should_fail_every_active_task() {
    let mut state = TaskActivityState::default();
    state.remember_task_snapshot(
        "project-1",
        "task-1",
        "运行任务",
        "running",
        Vec::new(),
        Some("2026-09-02T08:00:00Z"),
    );
    state.remember_task_snapshot(
        "project-1",
        "task-2",
        "等待任务",
        "running",
        vec![("request-1".to_owned(), true)],
        Some("2026-09-02T08:01:00Z"),
    );

    assert!(state.fail_active());
    assert!(
        state
            .snapshot()
            .iter()
            .all(|task| task.status == TaskActivityStatus::Failed)
    );
    assert!(!state.fail_active());
}

#[test]
fn task_snapshot_should_preserve_pending_ids_and_correct_stale_running_state() {
    let mut state = TaskActivityState::default();
    state.remember_task_snapshot(
        "project-1",
        "task-1",
        "多审批任务",
        "running",
        vec![
            ("request-1".to_owned(), true),
            ("request-2".to_owned(), true),
        ],
        Some("2026-09-02T08:00:00Z"),
    );
    for request_id in ["request-1", "request-2"] {
        state.apply_event(
            "project-1",
            &event(json!({
                "payload": {"request": {"requestId": request_id}},
                "taskId": "task-1",
                "type": "pending_request.resolved"
            })),
        );
        let expected = if request_id == "request-1" {
            TaskActivityStatus::Waiting
        } else {
            TaskActivityStatus::Running
        };
        assert_eq!(state.snapshot()[0].status, expected);
    }

    state.remember_task_snapshot(
        "project-1",
        "task-1",
        "多审批任务",
        "idle",
        Vec::new(),
        None,
    );
    assert_eq!(state.snapshot()[0].status, TaskActivityStatus::Completed);
}

#[test]
fn terminal_failures_and_task_removal_are_reduced_in_rust() {
    let mut state = TaskActivityState::default();
    state.remember_task("project-1", "task-1", "失败任务", None);
    state.apply_event(
        "project-1",
        &event(json!({
            "payload": {"status": "running"},
            "taskId": "task-1",
            "type": "task.status_updated"
        })),
    );
    state.apply_event(
        "project-1",
        &event(json!({
            "payload": {"message": "连接失败", "willRetry": false},
            "taskId": "task-1",
            "turnId": "turn-1",
            "type": "provider.error"
        })),
    );
    assert_eq!(state.snapshot()[0].status, TaskActivityStatus::Failed);

    state.apply_event(
        "project-1",
        &event(json!({
            "payload": {"reason": "deleted"},
            "taskId": "task-1",
            "type": "task.removed"
        })),
    );
    assert!(state.snapshot().is_empty());
}
