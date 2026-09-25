use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use tauri::{AppHandle, Manager};
use tokio::sync::{Mutex, Notify};

use crate::{
    domain::scheduled_task::{
        ScheduledTask, ScheduledTaskInput, ScheduledTaskRun, ScheduledTaskRunStatus,
        ScheduledTaskSchedule,
    },
    infrastructure::scheduled_tasks::{
        MAX_SCHEDULED_TASK_RUNS, ScheduledTaskStoreError, read_scheduled_tasks,
        resolve_schedule_runs, write_scheduled_tasks,
    },
};

use super::{error::AppError, scheduled_task_runner::start_scheduled_task_turn};

#[path = "scheduled_task_dispatch.rs"]
mod dispatch;

static NEXT_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Clone)]
pub(super) struct ScheduledTaskClaim {
    pub run_id: String,
    pub task: ScheduledTask,
}

#[derive(Clone, Default)]
struct RuntimeState {
    app_data: Option<PathBuf>,
    running: HashSet<String>,
    tasks: Vec<ScheduledTask>,
    dirty: bool,
}

impl RuntimeState {
    async fn commit_candidate(&mut self, mut candidate: Self) -> Result<(), AppError> {
        // 发布内存状态前完成原子落盘，失败时原状态仍可用于重试。
        persist(&candidate).await?;
        candidate.dirty = false;
        *self = candidate;
        Ok(())
    }
}

#[derive(Clone, Default)]
pub struct ScheduledTaskRuntime {
    inner: Arc<Mutex<RuntimeState>>,
    notify: Arc<Notify>,
    started: Arc<AtomicBool>,
}

impl ScheduledTaskRuntime {
    pub fn start(&self, app: AppHandle) {
        if self.started.swap(true, Ordering::AcqRel) {
            return;
        }
        let runtime = self.clone();
        tauri::async_runtime::spawn(async move { runtime.run(app).await });
    }

    async fn ensure_loaded(&self, app_data: &Path) -> Result<(), AppError> {
        let mut state = self.inner.lock().await;
        if state.app_data.is_some() {
            return Ok(());
        }
        state.tasks = read_scheduled_tasks(app_data)
            .await
            .map_err(map_store_error)?;
        if repair_interrupted_runs(&mut state.tasks, now_unix_ms()) {
            write_scheduled_tasks(app_data, &state.tasks)
                .await
                .map_err(map_store_error)?;
        }
        state.app_data = Some(app_data.to_owned());
        Ok(())
    }

    pub async fn list(&self, app_data: &Path) -> Result<Vec<ScheduledTask>, AppError> {
        self.ensure_loaded(app_data).await?;
        let mut tasks = self.inner.lock().await.tasks.clone();
        tasks.sort_by_key(|task| {
            (
                task.next_run_at_unix_ms.unwrap_or(i64::MAX),
                task.created_at_unix_ms,
            )
        });
        Ok(tasks)
    }

    pub async fn create(
        &self,
        app_data: &Path,
        input: ScheduledTaskInput,
    ) -> Result<ScheduledTask, AppError> {
        let now = now_unix_ms();
        let task = build_task(new_id("schedule"), input, now)?;
        self.ensure_loaded(app_data).await?;
        let mut current = self.inner.lock().await;
        let mut state = current.clone();
        state.tasks.push(task.clone());
        current.commit_candidate(state).await?;
        drop(current);
        self.notify.notify_one();
        Ok(task)
    }

    pub async fn update(
        &self,
        app_data: &Path,
        id: &str,
        input: ScheduledTaskInput,
    ) -> Result<ScheduledTask, AppError> {
        let now = now_unix_ms();
        let mut updated = build_task(id.to_owned(), input, now)?;
        self.ensure_loaded(app_data).await?;
        let mut current = self.inner.lock().await;
        let mut state = current.clone();
        let existing = state
            .tasks
            .iter_mut()
            .find(|task| task.id == id)
            .ok_or(AppError::ScheduledTaskNotFound)?;
        updated.created_at_unix_ms = existing.created_at_unix_ms;
        updated.last_run_at_unix_ms = existing.last_run_at_unix_ms;
        updated.last_run_status = existing.last_run_status.clone();
        updated.runs = existing.runs.clone();
        *existing = updated.clone();
        current.commit_candidate(state).await?;
        drop(current);
        self.notify.notify_one();
        Ok(updated)
    }

    pub async fn delete(&self, app_data: &Path, id: &str) -> Result<(), AppError> {
        self.ensure_loaded(app_data).await?;
        let mut current = self.inner.lock().await;
        let mut state = current.clone();
        if state.running.contains(id) {
            return Err(AppError::ScheduledTaskBusy);
        }
        let before = state.tasks.len();
        state.tasks.retain(|task| task.id != id);
        if state.tasks.len() == before {
            return Err(AppError::ScheduledTaskNotFound);
        }
        current.commit_candidate(state).await?;
        drop(current);
        self.notify.notify_one();
        Ok(())
    }

    pub async fn set_enabled(
        &self,
        app_data: &Path,
        id: &str,
        enabled: bool,
    ) -> Result<ScheduledTask, AppError> {
        self.ensure_loaded(app_data).await?;
        let now = now_unix_ms();
        let mut current = self.inner.lock().await;
        let mut state = current.clone();
        let task = state
            .tasks
            .iter_mut()
            .find(|task| task.id == id)
            .ok_or(AppError::ScheduledTaskNotFound)?;
        task.enabled = enabled;
        task.updated_at_unix_ms = now;
        if enabled {
            task.next_run_at_unix_ms = resolve_schedule_runs(&task.schedule, now, 1)
                .map_err(map_store_error)?
                .first()
                .copied();
            task.enabled = task.next_run_at_unix_ms.is_some();
        }
        let updated = task.clone();
        current.commit_candidate(state).await?;
        drop(current);
        self.notify.notify_one();
        Ok(updated)
    }

    pub async fn run_now(
        &self,
        app: AppHandle,
        app_data: &Path,
        id: &str,
    ) -> Result<ScheduledTask, AppError> {
        let claim = self
            .claim_pending(app_data, Some(id), now_unix_ms())
            .await?
            .pop()
            .ok_or(AppError::ScheduledTaskBusy)?;
        let task = claim.task.clone();
        self.spawn_claim(app, claim);
        Ok(task)
    }
}

pub(super) fn build_task(
    id: String,
    input: ScheduledTaskInput,
    now: i64,
) -> Result<ScheduledTask, AppError> {
    crate::domain::goal_input::validate_turn_input(&input.prompt, &input.turn_options)?;
    // 停用也校验规则；有限计划用 None 表达自然结束，不把正常结束当作保存错误。
    let next_run_at_unix_ms = resolve_schedule_runs(&input.schedule, now, 1)
        .map_err(map_store_error)?
        .first()
        .copied();
    let task = ScheduledTask {
        created_at_unix_ms: now,
        enabled: input.enabled && next_run_at_unix_ms.is_some(),
        id,
        last_run_at_unix_ms: None,
        last_run_status: None,
        name: input.name.trim().to_owned(),
        next_run_at_unix_ms,
        project_id: input.project_id,
        project_name: input.project_name,
        prompt: input.prompt,
        runs: Vec::new(),
        schedule: input.schedule,
        turn_options: input.turn_options,
        updated_at_unix_ms: now,
    };
    task.is_valid()
        .then_some(task)
        .ok_or(AppError::ScheduledTaskInvalid)
}

pub(super) fn claim_due_tasks(
    tasks: &mut [ScheduledTask],
    running: &mut HashSet<String>,
    now: i64,
    manual_id: Option<&str>,
) -> Vec<ScheduledTaskClaim> {
    let mut claims = Vec::new();
    for task in tasks {
        let selected = manual_id.map_or_else(
            || task.enabled && task.next_run_at_unix_ms.is_some_and(|next| next <= now),
            |id| task.id == id,
        );
        if !selected {
            continue;
        }
        if running.contains(&task.id) {
            if manual_id.is_none() {
                advance_schedule(task, now);
                task.last_run_at_unix_ms = Some(now);
                task.last_run_status = Some(ScheduledTaskRunStatus::Skipped);
                task.runs.push(ScheduledTaskRun {
                    error: Some("previous scheduled launch is still running".to_owned()),
                    finished_at_unix_ms: Some(now),
                    id: new_id("run"),
                    started_at_unix_ms: now,
                    status: ScheduledTaskRunStatus::Skipped,
                    task_id: None,
                });
                bound_runs(&mut task.runs);
            }
            continue;
        }
        running.insert(task.id.clone());
        if manual_id.is_none() {
            advance_schedule(task, now);
        }
        let run_id = new_id("run");
        task.last_run_at_unix_ms = Some(now);
        task.last_run_status = Some(ScheduledTaskRunStatus::Running);
        task.updated_at_unix_ms = now;
        task.runs.push(ScheduledTaskRun {
            error: None,
            finished_at_unix_ms: None,
            id: run_id.clone(),
            started_at_unix_ms: now,
            status: ScheduledTaskRunStatus::Running,
            task_id: None,
        });
        bound_runs(&mut task.runs);
        claims.push(ScheduledTaskClaim {
            run_id,
            task: task.clone(),
        });
    }
    claims
}

fn advance_schedule(task: &mut ScheduledTask, now: i64) {
    match task.schedule {
        ScheduledTaskSchedule::Once { .. } => {
            task.enabled = false;
            task.next_run_at_unix_ms = None;
        }
        ScheduledTaskSchedule::Rrule { .. } => {
            task.next_run_at_unix_ms = resolve_schedule_runs(&task.schedule, now, 1)
                .ok()
                .and_then(|dates| dates.first().copied());
            task.enabled = task.next_run_at_unix_ms.is_some();
        }
    }
    task.updated_at_unix_ms = now;
}

pub(super) fn repair_interrupted_runs(tasks: &mut [ScheduledTask], now: i64) -> bool {
    let mut repaired = false;
    for task in tasks {
        for run in &mut task.runs {
            if matches!(run.status, ScheduledTaskRunStatus::Running) {
                run.status = ScheduledTaskRunStatus::Failed;
                run.finished_at_unix_ms = Some(now);
                run.error = Some("application exited before launch was confirmed".to_owned());
                task.last_run_status = Some(ScheduledTaskRunStatus::Failed);
                task.updated_at_unix_ms = now;
                repaired = true;
            }
        }
    }
    repaired
}

pub(super) fn finish_claim(
    tasks: &mut [ScheduledTask],
    running: &mut HashSet<String>,
    claim: &ScheduledTaskClaim,
    finished_at: i64,
    result: Result<String, String>,
) {
    running.remove(&claim.task.id);
    let Some(task) = tasks.iter_mut().find(|task| task.id == claim.task.id) else {
        return;
    };
    let (status, task_id, error) = match result {
        Ok(task_id) => (ScheduledTaskRunStatus::Started, Some(task_id), None),
        Err(error) => (ScheduledTaskRunStatus::Failed, None, Some(error)),
    };
    if let Some(run) = task.runs.iter_mut().find(|run| run.id == claim.run_id) {
        run.finished_at_unix_ms = Some(finished_at);
        run.status = status.clone();
        run.task_id = task_id;
        run.error = error;
    }
    task.last_run_status = Some(status);
    task.updated_at_unix_ms = finished_at;
}

async fn persist(state: &RuntimeState) -> Result<(), AppError> {
    let app_data = state
        .app_data
        .as_deref()
        .ok_or(AppError::FilesystemRequestFailed)?;
    write_scheduled_tasks(app_data, &state.tasks)
        .await
        .map_err(map_store_error)
}

fn bound_runs(runs: &mut Vec<ScheduledTaskRun>) {
    if runs.len() > MAX_SCHEDULED_TASK_RUNS {
        runs.drain(..runs.len() - MAX_SCHEDULED_TASK_RUNS);
    }
}

fn map_store_error(error: ScheduledTaskStoreError) -> AppError {
    match error {
        ScheduledTaskStoreError::InvalidData | ScheduledTaskStoreError::InvalidSchedule => {
            AppError::ScheduledTaskInvalid
        }
        _ => AppError::FilesystemRequestFailed,
    }
}

fn new_id(prefix: &str) -> String {
    format!(
        "{prefix}-{}-{}",
        now_unix_ms(),
        NEXT_ID.fetch_add(1, Ordering::Relaxed)
    )
}

fn now_unix_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(i64::MAX as u128) as i64
}
