use super::*;

impl ScheduledTaskRuntime {
    pub(super) async fn claim_pending(
        &self,
        app_data: &Path,
        manual_id: Option<&str>,
        now: i64,
    ) -> Result<Vec<ScheduledTaskClaim>, AppError> {
        self.ensure_loaded(app_data).await?;
        let mut current = self.inner.lock().await;
        if let Some(id) = manual_id {
            if current.running.contains(id) {
                return Err(AppError::ScheduledTaskBusy);
            }
            if !current.tasks.iter().any(|task| task.id == id) {
                return Err(AppError::ScheduledTaskNotFound);
            }
        }
        let due = manual_id.is_some()
            || current.tasks.iter().any(|task| {
                task.enabled && task.next_run_at_unix_ms.is_some_and(|next| next <= now)
            });
        if !due {
            if current.dirty {
                persist(&current).await?;
                current.dirty = false;
            }
            return Ok(Vec::new());
        }
        // 先写入候选状态，再替换内存。失败或取消都不会留下虚假的 running 和已推进的时间。
        let mut next = current.clone();
        let claims = claim_due_tasks(&mut next.tasks, &mut next.running, now, manual_id);
        current.commit_candidate(next).await?;
        Ok(claims)
    }

    pub(super) async fn run(self, app: AppHandle) {
        let app_data = match app.path().app_data_dir() {
            Ok(path) => path,
            Err(error) => {
                crate::infrastructure::diagnostics::record_error(
                    "scheduled_task_storage_unavailable",
                    error,
                );
                self.started.store(false, Ordering::Release);
                return;
            }
        };
        let mut failures = 0_u32;
        loop {
            let delay = match self.claim_pending(&app_data, None, now_unix_ms()).await {
                Ok(claims) => {
                    failures = 0;
                    for claim in claims {
                        self.spawn_claim(app.clone(), claim);
                    }
                    let state = self.inner.lock().await;
                    let now = now_unix_ms();
                    state
                        .tasks
                        .iter()
                        .filter(|task| task.enabled)
                        .filter_map(|task| task.next_run_at_unix_ms)
                        .min()
                        .map(|next| Duration::from_millis(next.saturating_sub(now).max(1) as u64))
                        .unwrap_or(Duration::from_secs(24 * 60 * 60))
                }
                Err(error) => {
                    crate::infrastructure::diagnostics::record_error(
                        "scheduled_task_dispatch_failed",
                        error,
                    );
                    let delay = Duration::from_secs((1_u64 << failures.min(5)).min(30));
                    failures = failures.saturating_add(1);
                    delay
                }
            };
            // 瞬时读写错误只进入有界退避，不结束整个调度器；编辑任务仍可提前唤醒。
            tokio::select! {
                _ = tokio::time::sleep(delay) => {},
                _ = self.notify.notified() => {},
            }
        }
    }

    pub(super) fn spawn_claim(&self, app: AppHandle, claim: ScheduledTaskClaim) {
        let runtime = self.clone();
        tauri::async_runtime::spawn(async move {
            let result = start_scheduled_task_turn(&app, &claim.task).await;
            let mut state = runtime.inner.lock().await;
            let RuntimeState { tasks, running, .. } = &mut *state;
            finish_claim(tasks, running, &claim, now_unix_ms(), result);
            // 启动结果已经发生，不能回滚后重复启动；保留脏标记交给调度循环重试落盘。
            state.dirty = true;
            match persist(&state).await {
                Ok(()) => state.dirty = false,
                Err(error) => crate::infrastructure::diagnostics::record_error(
                    "scheduled_task_result_persist_failed",
                    error,
                ),
            }
            drop(state);
            runtime.notify.notify_one();
        });
    }
}

#[cfg(test)]
#[path = "scheduled_task_dispatch_tests.rs"]
mod tests;
