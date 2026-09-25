use std::time::Duration;

use tauri::{AppHandle, Manager as _};

use super::{AppState, RuntimeSession};
use crate::domain::runtime::RuntimeStatus;

const STABLE_RUNTIME_UPTIME: Duration = Duration::from_secs(60);
const MAX_RESTART_DELAY_SECS: u64 = 30;

pub(super) fn runtime_restart_plan(previous_attempt: u32, uptime: Duration) -> (u32, Duration) {
    let attempt = if uptime >= STABLE_RUNTIME_UPTIME {
        0
    } else {
        previous_attempt
    };
    let exponent = attempt.min(5);
    let delay = Duration::from_secs((1_u64 << exponent).min(MAX_RESTART_DELAY_SECS));
    (attempt.saturating_add(1), delay)
}

pub(super) fn invalidate_runtime_restart(runtime: &mut RuntimeSession) {
    runtime.restart_generation = runtime.restart_generation.wrapping_add(1);
}

pub(super) fn mark_runtime_started(runtime: &mut RuntimeSession) {
    runtime.runtime_started_at = Some(tokio::time::Instant::now());
}

pub(super) fn prepare_runtime_restart(runtime: &mut RuntimeSession) -> (u64, Duration) {
    let uptime = runtime
        .runtime_started_at
        .take()
        .map_or(Duration::ZERO, |started_at| started_at.elapsed());
    let (next_attempt, delay) = runtime_restart_plan(runtime.restart_attempt, uptime);
    runtime.restart_attempt = next_attempt;
    invalidate_runtime_restart(runtime);
    crate::infrastructure::diagnostics::record(
        crate::infrastructure::diagnostics::DiagnosticLevel::Warn,
        "codex_runtime_restart_scheduled",
        None,
        std::collections::BTreeMap::from([
            (
                "restartGeneration".to_owned(),
                runtime.restart_generation.into(),
            ),
            ("restartAttempt".to_owned(), next_attempt.into()),
            ("delayMs".to_owned(), (delay.as_millis() as u64).into()),
            (
                "uptimeMs".to_owned(),
                (uptime.as_millis().min(u64::MAX as u128) as u64).into(),
            ),
        ]),
    );
    (runtime.restart_generation, delay)
}

pub(super) fn schedule_runtime_restart(app: AppHandle, generation: u64, delay: Duration) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(delay).await;
        let state = app.state::<AppState>();
        {
            let runtime = state.runtime.lock().await;
            if runtime.restart_generation != generation
                || runtime.snapshot.status != RuntimeStatus::Failed
            {
                return;
            }
        }
        let app_data = match app.path().app_data_dir() {
            Ok(app_data) => app_data,
            Err(error) => {
                crate::infrastructure::diagnostics::record_error(
                    "codex_restart_app_data_resolve_failed",
                    error,
                );
                return;
            }
        };
        // Box 固定递归调度 future 的大小，后续失败继续由同一 supervisor 退避处理。
        if let Err(error) = Box::pin(state.start_codex(&app, &app_data)).await {
            crate::infrastructure::diagnostics::record_error(
                "codex_automatic_restart_failed",
                error,
            );
        }
    });
}
