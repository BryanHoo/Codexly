use std::{
    io,
    path::{Path, PathBuf},
};

use chrono::{DateTime, Utc};
use rrule::{RRuleSet, Tz};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::fs;

use crate::domain::scheduled_task::{ScheduledTask, ScheduledTaskSchedule};

#[path = "scheduled_task_seek.rs"]
mod seek;

pub const MAX_SCHEDULED_TASK_RUNS: usize = 20;
const MIN_RECURRENCE_MILLIS: i64 = 60_000;
const STORAGE_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Error)]
pub enum ScheduledTaskStoreError {
    #[error("invalid scheduled task data")]
    InvalidData,
    #[error("invalid scheduled task schedule")]
    InvalidSchedule,
    #[error(transparent)]
    Io(#[from] io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredScheduledTasks {
    schema_version: u32,
    tasks: Vec<ScheduledTask>,
}

#[cfg(test)]
pub fn validate_and_resolve_next_run(
    schedule: &ScheduledTaskSchedule,
    after_unix_ms: i64,
) -> Result<i64, ScheduledTaskStoreError> {
    resolve_schedule_runs(schedule, after_unix_ms, 1)?
        .first()
        .copied()
        .ok_or(ScheduledTaskStoreError::InvalidSchedule)
}

/// 预览和调度共用同一解析入口；空结果表示计划已结束，畸形规则仍返回错误。
pub fn resolve_schedule_runs(
    schedule: &ScheduledTaskSchedule,
    after_unix_ms: i64,
    limit: u16,
) -> Result<Vec<i64>, ScheduledTaskStoreError> {
    if !(1..=5).contains(&limit) {
        return Err(ScheduledTaskStoreError::InvalidSchedule);
    }
    match schedule {
        ScheduledTaskSchedule::Once { at_unix_ms } => (*at_unix_ms > after_unix_ms)
            .then_some(vec![*at_unix_ms])
            .ok_or(ScheduledTaskStoreError::InvalidSchedule),
        ScheduledTaskSchedule::Rrule {
            rrule,
            start_at_unix_ms,
            timezone,
        } => {
            let set = parse_rrule(*start_at_unix_ms, timezone, rrule)?;
            if set.get_rrule().iter().any(|rule| {
                rule.get_count().is_some_and(|count| count > 10_000)
                    || (rule.get_freq() == rrule::Frequency::Secondly && rule.get_interval() < 60)
                    || rule.get_by_second().len() > 1
            }) {
                return Err(ScheduledTaskStoreError::InvalidSchedule);
            }
            let first_dates = set.clone().all(2).dates;
            if first_dates.is_empty() {
                return Err(ScheduledTaskStoreError::InvalidSchedule);
            }
            if first_dates.len() > 1
                && first_dates[1].timestamp_millis() - first_dates[0].timestamp_millis()
                    < MIN_RECURRENCE_MILLIS
            {
                return Err(ScheduledTaskStoreError::InvalidSchedule);
            }
            let threshold = utc_datetime(after_unix_ms.saturating_add(1))?;
            let threshold = threshold.with_timezone(&Tz::UTC);
            let result = seek::seek_recurrence(set, threshold)
                .after(threshold)
                .all(limit);
            // 引擎触发保护上限不能伪装成已结束；返回数量也始终受调用方上限约束。
            if result.limited && result.dates.len() < usize::from(limit) {
                return Err(ScheduledTaskStoreError::InvalidSchedule);
            }
            Ok(result
                .dates
                .iter()
                .map(DateTime::timestamp_millis)
                .collect())
        }
    }
}

fn parse_rrule(
    start_at_unix_ms: i64,
    timezone: &str,
    rrule: &str,
) -> Result<RRuleSet, ScheduledTaskStoreError> {
    let timezone_value = timezone
        .parse::<chrono_tz::Tz>()
        .map_err(|_| ScheduledTaskStoreError::InvalidSchedule)?;
    let start = utc_datetime(start_at_unix_ms)?.with_timezone(&timezone_value);
    let normalized = rrule.trim().strip_prefix("RRULE:").unwrap_or(rrule.trim());
    if normalized.is_empty()
        || normalized.len() > 2_048
        || normalized.contains('\r')
        || normalized.contains('\n')
    {
        return Err(ScheduledTaskStoreError::InvalidSchedule);
    }
    let source = format!(
        "DTSTART;TZID={timezone}:{}\nRRULE:{normalized}",
        start.format("%Y%m%dT%H%M%S")
    );
    source
        .parse::<RRuleSet>()
        .map_err(|_| ScheduledTaskStoreError::InvalidSchedule)
}

fn utc_datetime(value: i64) -> Result<DateTime<Utc>, ScheduledTaskStoreError> {
    DateTime::from_timestamp_millis(value).ok_or(ScheduledTaskStoreError::InvalidSchedule)
}

pub async fn read_scheduled_tasks(
    app_data: &Path,
) -> Result<Vec<ScheduledTask>, ScheduledTaskStoreError> {
    let bytes = match fs::read(storage_path(app_data)).await {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error.into()),
    };
    let stored: StoredScheduledTasks = serde_json::from_slice(&bytes)?;
    if stored.schema_version != STORAGE_SCHEMA_VERSION
        || stored.tasks.iter().any(|task| !task.is_valid())
    {
        return Err(ScheduledTaskStoreError::InvalidData);
    }
    for task in &stored.tasks {
        if !matches!(task.schedule, ScheduledTaskSchedule::Once { .. }) {
            let _ = resolve_schedule_runs(
                &task.schedule,
                task.created_at_unix_ms.saturating_sub(1),
                1,
            )?;
        }
    }
    Ok(stored.tasks)
}

pub async fn write_scheduled_tasks(
    app_data: &Path,
    tasks: &[ScheduledTask],
) -> Result<(), ScheduledTaskStoreError> {
    if tasks.iter().any(|task| !task.is_valid()) {
        return Err(ScheduledTaskStoreError::InvalidData);
    }
    let mut bounded_tasks = tasks.to_vec();
    for task in &mut bounded_tasks {
        if task.runs.len() > MAX_SCHEDULED_TASK_RUNS {
            task.runs.drain(..task.runs.len() - MAX_SCHEDULED_TASK_RUNS);
        }
    }
    let target = storage_path(app_data);
    let bytes = serde_json::to_vec(&StoredScheduledTasks {
        schema_version: STORAGE_SCHEMA_VERSION,
        tasks: bounded_tasks,
    })?;
    super::atomic_file::write_bytes(&target, bytes).await?;
    Ok(())
}

fn storage_path(app_data: &Path) -> PathBuf {
    app_data.join("scheduled-tasks").join("v1.json")
}
