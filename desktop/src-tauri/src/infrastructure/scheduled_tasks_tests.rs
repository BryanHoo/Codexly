use std::sync::atomic::{AtomicU64, Ordering};

use serde_json::json;

use super::scheduled_tasks::{
    MAX_SCHEDULED_TASK_RUNS, read_scheduled_tasks, resolve_schedule_runs,
    validate_and_resolve_next_run, write_scheduled_tasks,
};
use crate::domain::{
    conversation::{AgentPromptInput, AgentTurnOptions},
    scheduled_task::{
        ScheduledTask, ScheduledTaskRun, ScheduledTaskRunStatus, ScheduledTaskSchedule,
    },
};

static TEST_ID: AtomicU64 = AtomicU64::new(1);

#[test]
#[ignore = "run with --release --ignored --nocapture to measure recurrence seeking"]
fn scheduled_preview_performance() {
    use std::time::Instant;
    let source = "DTSTART;TZID=America/New_York:19700101T093000\nRRULE:FREQ=HOURLY;INTERVAL=4";
    let set: rrule::RRuleSet = source.parse().unwrap();
    let start = set.get_dt_start().timestamp_millis();
    let after = 1_893_456_000_000;
    let schedule = ScheduledTaskSchedule::Rrule {
        rrule: "FREQ=HOURLY;INTERVAL=4".to_owned(),
        start_at_unix_ms: start,
        timezone: "America/New_York".to_owned(),
    };
    let before = Instant::now();
    let expected = set
        .after(
            chrono::DateTime::from_timestamp_millis(after + 1)
                .unwrap()
                .with_timezone(&rrule::Tz::UTC),
        )
        .all(5);
    let baseline = before.elapsed();
    let before = Instant::now();
    for _ in 0..100 {
        let actual = resolve_schedule_runs(&schedule, after, 5).unwrap();
        assert_eq!(
            actual,
            expected
                .dates
                .iter()
                .map(chrono::DateTime::timestamp_millis)
                .collect::<Vec<_>>()
        );
    }
    let average = before.elapsed() / 100;
    println!(
        "scheduled_preview baseline={baseline:?}, seek_average={average:?}, samples=100, dates=5"
    );
    assert!(
        average < baseline,
        "seeking should avoid replaying sixty years of history"
    );
}

#[test]
fn scheduled_preview_should_reject_unbounded_count_work_and_subminute_rules() {
    for rrule in [
        "FREQ=HOURLY;COUNT=10001",
        "FREQ=SECONDLY;COUNT=1",
        "FREQ=DAILY;BYSECOND=0,30",
    ] {
        let schedule = ScheduledTaskSchedule::Rrule {
            rrule: rrule.to_owned(),
            start_at_unix_ms: 1_893_456_000_000,
            timezone: "UTC".to_owned(),
        };
        assert!(resolve_schedule_runs(&schedule, 1_893_456_000_000 - 1, 5).is_err());
    }
}

#[test]
fn scheduled_preview_should_match_engine_when_seeking_across_dst_and_calendar_boundaries() {
    use chrono::{DateTime, Utc};
    use rrule::{RRuleSet, Tz};
    for (start, after) in [
        ("20240301T093000", "2024-03-12T00:00:00Z"),
        ("20241001T013000", "2024-11-05T00:00:00Z"),
        ("20240131T093000", "2025-03-01T00:00:00Z"),
    ] {
        for rule in [
            "FREQ=HOURLY;INTERVAL=4",
            "FREQ=DAILY;INTERVAL=3",
            "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,FR",
            "FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=1,15,-1",
            "FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29",
        ] {
            let source = format!("DTSTART;TZID=America/New_York:{start}\nRRULE:{rule}");
            let set: RRuleSet = source.parse().unwrap();
            let after = DateTime::parse_from_rfc3339(after)
                .unwrap()
                .with_timezone(&Utc);
            let schedule = ScheduledTaskSchedule::Rrule {
                rrule: rule.to_owned(),
                start_at_unix_ms: set.get_dt_start().timestamp_millis(),
                timezone: "America/New_York".to_owned(),
            };
            let expected: Vec<_> = set
                .after((after + chrono::Duration::milliseconds(1)).with_timezone(&Tz::UTC))
                .all(5)
                .dates
                .iter()
                .map(DateTime::timestamp_millis)
                .collect();
            assert_eq!(
                resolve_schedule_runs(&schedule, after.timestamp_millis(), 5).unwrap(),
                expected,
                "{source}"
            );
        }
    }
}

#[test]
fn scheduled_preview_should_bound_results_and_respect_month_patterns() {
    let start = 1_893_456_000_000; // 2030-01-01 UTC
    for (rule, expected) in [
        (
            "FREQ=MONTHLY;BYMONTHDAY=-1;BYHOUR=9;BYMINUTE=0",
            vec!["2030-01-31", "2030-02-28", "2030-03-31"],
        ),
        (
            "FREQ=MONTHLY;BYDAY=2WE,4WE;BYHOUR=9;BYMINUTE=0",
            vec!["2030-01-09", "2030-01-23", "2030-02-13"],
        ),
        (
            "FREQ=WEEKLY;INTERVAL=2;WKST=MO;BYDAY=MO,WE,FR;BYHOUR=9;BYMINUTE=0",
            vec!["2030-01-02", "2030-01-04", "2030-01-14"],
        ),
    ] {
        let schedule = ScheduledTaskSchedule::Rrule {
            rrule: rule.to_owned(),
            start_at_unix_ms: start,
            timezone: "UTC".to_owned(),
        };
        let dates = resolve_schedule_runs(&schedule, start - 1, 3).unwrap();
        let actual: Vec<_> = dates
            .iter()
            .map(|date| {
                chrono::DateTime::from_timestamp_millis(*date)
                    .unwrap()
                    .format("%Y-%m-%d")
                    .to_string()
            })
            .collect();
        assert_eq!(actual, expected);
        assert!(resolve_schedule_runs(&schedule, start, 6).is_err());
        assert!(resolve_schedule_runs(&schedule, start, 0).is_err());
    }
}

#[test]
fn scheduled_preview_should_stop_at_count_and_inclusive_end_date() {
    for rule in ["FREQ=DAILY;COUNT=2", "FREQ=DAILY;UNTIL=20300102T235959Z"] {
        let start = 1_893_456_000_000;
        let schedule = ScheduledTaskSchedule::Rrule {
            rrule: rule.to_owned(),
            start_at_unix_ms: start,
            timezone: "UTC".to_owned(),
        };
        assert_eq!(
            resolve_schedule_runs(&schedule, start - 1, 5).unwrap(),
            vec![start, start + 86_400_000]
        );
        assert!(
            resolve_schedule_runs(&schedule, start + 86_400_000, 5)
                .unwrap()
                .is_empty()
        );
    }
}

fn recurring_schedule() -> ScheduledTaskSchedule {
    ScheduledTaskSchedule::Rrule {
        rrule: "FREQ=DAILY".to_owned(),
        start_at_unix_ms: 1_709_971_200_000,
        timezone: "America/New_York".to_owned(),
    }
}

fn task_with_runs(run_count: usize) -> ScheduledTask {
    ScheduledTask {
        created_at_unix_ms: 1_700_000_000_000,
        enabled: true,
        id: "scheduled-a".to_owned(),
        last_run_at_unix_ms: None,
        last_run_status: None,
        name: "Daily check".to_owned(),
        next_run_at_unix_ms: Some(1_709_971_200_000),
        project_id: "project-a".to_owned(),
        project_name: "Project A".to_owned(),
        prompt: AgentPromptInput {
            attachments: Vec::new(),
            skills: Vec::new(),
            text: "Inspect the repository".to_owned(),
        },
        runs: (0..run_count)
            .map(|index| ScheduledTaskRun {
                error: None,
                finished_at_unix_ms: Some(1_700_000_000_100 + index as i64),
                id: format!("run-{index}"),
                started_at_unix_ms: 1_700_000_000_000 + index as i64,
                status: ScheduledTaskRunStatus::Started,
                task_id: Some(format!("task-{index}")),
            })
            .collect(),
        schedule: recurring_schedule(),
        turn_options: AgentTurnOptions {
            approval_policy: json!("never"),
            ..AgentTurnOptions::default()
        },
        updated_at_unix_ms: 1_700_000_000_000,
    }
}

#[test]
fn scheduled_tasks_rrule_should_preserve_wall_clock_across_dst() {
    let before_dst = validate_and_resolve_next_run(&recurring_schedule(), 1_709_971_199_000)
        .expect("valid rule should resolve");
    let after_dst = validate_and_resolve_next_run(&recurring_schedule(), before_dst)
        .expect("daily rule should continue");

    assert_eq!(before_dst, 1_709_971_200_000);
    assert_eq!(after_dst, 1_710_054_000_000);
    assert_eq!(after_dst - before_dst, 82_800_000);
}

#[test]
fn scheduled_tasks_should_reject_runaway_recurrence() {
    let schedule = ScheduledTaskSchedule::Rrule {
        rrule: "FREQ=SECONDLY".to_owned(),
        start_at_unix_ms: 1_700_000_000_000,
        timezone: "UTC".to_owned(),
    };

    assert!(validate_and_resolve_next_run(&schedule, 1_699_999_999_000).is_err());
}

#[test]
fn scheduled_tasks_contract_should_reject_cron() {
    let cron = json!({
        "expression": "0 9 * * 1-5",
        "startAtUnixMs": 1_709_992_800_000_i64,
        "timezone": "America/New_York",
        "type": "cron"
    });

    assert!(serde_json::from_value::<ScheduledTaskSchedule>(cron).is_err());
}

#[test]
fn scheduled_task_schedule_should_use_frontend_camel_case_fields() {
    let once = json!({
        "atUnixMs": 2_000_000_000_000_i64,
        "type": "once"
    });
    let recurring = json!({
        "rrule": "RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=30",
        "startAtUnixMs": 2_000_000_000_000_i64,
        "timezone": "Asia/Shanghai",
        "type": "rrule"
    });

    let once_schedule = serde_json::from_value::<ScheduledTaskSchedule>(once.clone())
        .expect("once schedule should accept frontend fields");
    let recurring_schedule = serde_json::from_value::<ScheduledTaskSchedule>(recurring.clone())
        .expect("recurring schedule should accept frontend fields");

    assert_eq!(serde_json::to_value(once_schedule).unwrap(), once);
    assert_eq!(serde_json::to_value(recurring_schedule).unwrap(), recurring);
}

#[tokio::test]
async fn scheduled_tasks_should_restore_atomically_with_bounded_runs() {
    let root = std::env::temp_dir().join(format!(
        "codeagent-scheduled-tasks-{}-{}",
        std::process::id(),
        TEST_ID.fetch_add(1, Ordering::Relaxed)
    ));
    let task = task_with_runs(MAX_SCHEDULED_TASK_RUNS + 5);

    write_scheduled_tasks(&root, &[task])
        .await
        .expect("scheduled tasks should persist");
    let restored = read_scheduled_tasks(&root)
        .await
        .expect("scheduled tasks should restore");

    assert_eq!(restored.len(), 1);
    assert_eq!(restored[0].runs.len(), MAX_SCHEDULED_TASK_RUNS);
    assert_eq!(restored[0].runs[0].id, "run-5");
    assert_eq!(restored[0].runs.last().unwrap().id, "run-24");

    tokio::fs::remove_dir_all(root)
        .await
        .expect("test directory should clean up");
}
