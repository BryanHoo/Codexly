use std::collections::HashSet;

use crate::domain::{
    conversation::{AgentPromptInput, AgentTurnOptions},
    scheduled_task::{ScheduledTaskInput, ScheduledTaskRunStatus, ScheduledTaskSchedule},
};

use crate::infrastructure::scheduled_tasks::{read_scheduled_tasks, write_scheduled_tasks};

use super::scheduled_task_runtime::{
    ScheduledTaskRuntime, build_task, claim_due_tasks, finish_claim, repair_interrupted_runs,
};

fn input(schedule: ScheduledTaskSchedule) -> ScheduledTaskInput {
    ScheduledTaskInput {
        enabled: true,
        name: "Daily review".to_owned(),
        project_id: "project-a".to_owned(),
        project_name: "Project A".to_owned(),
        prompt: AgentPromptInput::text("Review the repository"),
        schedule,
        turn_options: AgentTurnOptions::default(),
    }
}

#[test]
fn scheduled_goal_should_reject_invalid_input_before_persistence() {
    let mut request = input(ScheduledTaskSchedule::Once {
        at_unix_ms: 2_000_000_000_000,
    });
    request.turn_options.goal_mode = true;
    request.prompt.text = "x".repeat(4001);
    let result = build_task("task".to_owned(), request, 1_000);
    assert!(
        result.is_err(),
        "invalid Goal must not become a scheduled task"
    );
}

#[tokio::test]
async fn scheduled_goal_should_report_native_error_without_loading_storage() {
    let root = std::env::temp_dir().join(format!(
        "codeagent-goal-preflight-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let runtime = ScheduledTaskRuntime::default();
    let mut request = input(ScheduledTaskSchedule::Once {
        at_unix_ms: 2_000_000_000_000,
    });
    request.turn_options.goal_mode = true;
    request
        .prompt
        .skills
        .push(serde_json::json!({"id":"skill","name":"skill"}));
    let error = runtime.create(&root, request.clone()).await.unwrap_err();
    assert_eq!(
        serde_json::to_value(error).unwrap()["code"],
        "GOAL_STRUCTURED_INPUT_UNSUPPORTED"
    );
    let error = runtime.update(&root, "missing", request).await.unwrap_err();
    assert_eq!(
        serde_json::to_value(error).unwrap()["code"],
        "GOAL_STRUCTURED_INPUT_UNSUPPORTED"
    );
    assert!(!root.exists(), "invalid Goal must not initialize storage");
}

#[test]
fn exhausted_recurring_schedule_should_remain_valid_and_disabled() {
    let schedule = ScheduledTaskSchedule::Rrule {
        rrule: "FREQ=DAILY;COUNT=2".to_owned(),
        start_at_unix_ms: 1_893_456_000_000,
        timezone: "UTC".to_owned(),
    };
    let task = build_task("ended".to_owned(), input(schedule), 1_894_000_000_000)
        .expect("a completed schedule is valid data");
    assert!(!task.enabled);
    assert_eq!(task.next_run_at_unix_ms, None);
}

#[test]
fn disabled_task_should_still_reject_invalid_recurrence() {
    let mut value = input(ScheduledTaskSchedule::Rrule {
        rrule: "not a rule".to_owned(),
        start_at_unix_ms: 1_893_456_000_000,
        timezone: "UTC".to_owned(),
    });
    value.enabled = false;
    assert!(build_task("invalid".to_owned(), value, 1_893_456_000_000).is_err());
}

#[tokio::test]
async fn failed_scheduled_task_writes_should_preserve_memory_and_allow_retry() {
    let root = std::env::temp_dir().join(format!(
        "codeagent-schedule-rollback-{}",
        std::process::id()
    ));
    let runtime = ScheduledTaskRuntime::default();
    let original_input = input(ScheduledTaskSchedule::Once {
        at_unix_ms: 2_000_000_000_000,
    });
    let created = runtime.create(&root, original_input.clone()).await.unwrap();
    let directory = root.join("scheduled-tasks");
    let backup = root.join("backup");
    tokio::fs::rename(&directory, &backup).await.unwrap();
    tokio::fs::write(&directory, b"blocked").await.unwrap();

    let mut updated = original_input.clone();
    updated.name = "Changed".to_owned();
    assert!(runtime.update(&root, &created.id, updated).await.is_err());
    assert_eq!(runtime.list(&root).await.unwrap()[0].name, created.name);
    assert!(
        runtime
            .set_enabled(&root, &created.id, false)
            .await
            .is_err()
    );
    assert!(runtime.list(&root).await.unwrap()[0].enabled);
    assert!(runtime.delete(&root, &created.id).await.is_err());
    assert_eq!(runtime.list(&root).await.unwrap().len(), 1);
    assert!(runtime.create(&root, original_input).await.is_err());
    assert_eq!(runtime.list(&root).await.unwrap().len(), 1);

    tokio::fs::remove_file(&directory).await.unwrap();
    tokio::fs::rename(&backup, &directory).await.unwrap();
    runtime
        .set_enabled(&root, &created.id, false)
        .await
        .unwrap();
    assert!(!read_scheduled_tasks(&root).await.unwrap()[0].enabled);
    tokio::fs::remove_dir_all(root).await.unwrap();
}

#[test]
fn recurring_task_should_coalesce_missed_occurrences() {
    let schedule = ScheduledTaskSchedule::Rrule {
        rrule: "RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=0".to_owned(),
        start_at_unix_ms: 1_709_971_200_000,
        timezone: "America/New_York".to_owned(),
    };
    let mut task = build_task("schedule-a".to_owned(), input(schedule), 1_709_970_000_000)
        .expect("task should be valid");
    task.next_run_at_unix_ms = Some(1_709_971_200_000);
    let now = 1_710_140_400_000;
    let mut tasks = vec![task];
    let mut running = HashSet::new();

    let claims = claim_due_tasks(&mut tasks, &mut running, now, None);

    assert_eq!(claims.len(), 1);
    assert!(
        tasks[0]
            .next_run_at_unix_ms
            .is_some_and(|value| value > now)
    );
    assert!(claim_due_tasks(&mut tasks, &mut running, now, None).is_empty());
}

#[test]
fn one_time_task_should_disable_after_claim_and_record_result() {
    let mut task = build_task(
        "schedule-b".to_owned(),
        input(ScheduledTaskSchedule::Once { at_unix_ms: 200 }),
        100,
    )
    .expect("task should be valid");
    let mut tasks = vec![task.clone()];
    let mut running = HashSet::new();

    let claim = claim_due_tasks(&mut tasks, &mut running, 200, None)
        .pop()
        .expect("due task should be claimed");
    assert!(!tasks[0].enabled);
    assert_eq!(tasks[0].next_run_at_unix_ms, None);
    assert!(matches!(
        tasks[0].last_run_status,
        Some(ScheduledTaskRunStatus::Running)
    ));

    finish_claim(
        &mut tasks,
        &mut running,
        &claim,
        250,
        Ok("task-codex".to_owned()),
    );
    task = tasks.pop().expect("task should remain");
    assert!(matches!(
        task.last_run_status,
        Some(ScheduledTaskRunStatus::Started)
    ));
    assert_eq!(task.runs[0].task_id.as_deref(), Some("task-codex"));
    assert!(running.is_empty());
}

#[test]
fn overlapping_occurrence_should_skip_and_interrupted_run_should_recover() {
    let schedule = ScheduledTaskSchedule::Rrule {
        rrule: "RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=0".to_owned(),
        start_at_unix_ms: 1_709_971_200_000,
        timezone: "America/New_York".to_owned(),
    };
    let mut tasks = vec![
        build_task("schedule-c".to_owned(), input(schedule), 1_709_970_000_000)
            .expect("task should be valid"),
    ];
    tasks[0].next_run_at_unix_ms = Some(1_709_971_200_000);
    let mut running = HashSet::from(["schedule-c".to_owned()]);

    assert!(claim_due_tasks(&mut tasks, &mut running, 1_710_140_400_000, None).is_empty());
    assert!(matches!(
        tasks[0].last_run_status,
        Some(ScheduledTaskRunStatus::Skipped)
    ));
    assert!(
        tasks[0]
            .next_run_at_unix_ms
            .is_some_and(|value| value > 1_710_140_400_000)
    );

    tasks[0].runs[0].status = ScheduledTaskRunStatus::Running;
    assert!(repair_interrupted_runs(&mut tasks, 1_710_140_500_000));
    assert!(matches!(
        tasks[0].runs[0].status,
        ScheduledTaskRunStatus::Failed
    ));
}

#[tokio::test]
async fn frontend_input_should_create_persist_and_complete_a_scheduled_task() {
    let root = std::env::temp_dir().join(format!(
        "codeagent-scheduled-task-flow-{}",
        std::process::id()
    ));
    let frontend_input = serde_json::json!({
        "enabled": true,
        "name": "Daily review",
        "projectId": "project-a",
        "projectName": "Project A",
        "prompt": { "attachments": [], "skills": [], "text": "Review", "type": "prompt" },
        "schedule": { "atUnixMs": 2_000_000_000_000_i64, "type": "once" },
        "turnOptions": {
            "approvalPolicy": "never",
            "approvalsReviewer": "user",
            "model": "gpt-5.6-sol",
            "reasoningEffort": "high",
            "sandboxMode": "workspace-write"
        }
    });
    let input = serde_json::from_value::<ScheduledTaskInput>(frontend_input)
        .expect("frontend input should deserialize");
    let runtime = ScheduledTaskRuntime::default();

    let created = runtime
        .create(&root, input)
        .await
        .expect("task should be created");
    let mut tasks = read_scheduled_tasks(&root)
        .await
        .expect("created task should persist");
    let mut running = HashSet::new();
    let claim = claim_due_tasks(&mut tasks, &mut running, 2_000_000_000_000, None)
        .pop()
        .expect("due task should be claimed");
    finish_claim(
        &mut tasks,
        &mut running,
        &claim,
        2_000_000_000_100,
        Ok("task-codex".to_owned()),
    );
    write_scheduled_tasks(&root, &tasks)
        .await
        .expect("completed run should persist");
    let completed = read_scheduled_tasks(&root)
        .await
        .expect("completed run should restore");

    assert_eq!(completed[0].id, created.id);
    assert!(matches!(
        completed[0].last_run_status,
        Some(ScheduledTaskRunStatus::Started)
    ));
    assert_eq!(completed[0].runs[0].task_id.as_deref(), Some("task-codex"));

    tokio::fs::remove_dir_all(root)
        .await
        .expect("test directory should clean up");
}
