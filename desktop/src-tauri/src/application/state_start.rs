use super::*;

impl AppState {
    pub async fn start_codex(
        &self,
        app: &AppHandle,
        app_data: &Path,
    ) -> Result<RuntimeSnapshot, AppError> {
        self.start_runtime_once(|| self.spawn_codex(app, app_data))
            .await
    }

    pub(super) async fn start_runtime_once<F>(
        &self,
        start: impl FnOnce() -> F,
    ) -> Result<RuntimeSnapshot, AppError>
    where
        F: Future<Output = Result<RuntimeSnapshot, AppError>>,
    {
        // 并发调用共享一次启动；等待期间不占用全局状态锁，取消后允许下一位接手。
        let _start_guard = match self.runtime_start.try_lock() {
            Ok(guard) => guard,
            Err(_) => {
                let guard = self.runtime_start.lock().await;
                if self.runtime.lock().await.snapshot.status == RuntimeStatus::Failed {
                    return Err(AppError::CodexRuntimeStartFailed);
                }
                guard
            }
        };
        {
            let runtime = self.runtime.lock().await;
            if runtime.snapshot.status == RuntimeStatus::Ready {
                return Ok(runtime.snapshot);
            }
        }
        let delivery = prepare_event_delivery(&self.runtime).await;
        {
            let mut runtime = self.runtime.lock().await;
            invalidate_runtime_restart(&mut runtime);
            // Provider 重启后旧用量和计划不再属于当前运行时；窗口重连不走此分支。
            runtime.task_snapshot_metadata.clear();
            runtime.task_failure_projection.clear();
            runtime.task_skill_projection.clear();
            let event = runtime.transition(RuntimeStatus::Starting, Some(ProviderKind::Codex));
            drop(runtime);
            delivery.send(event).await;
        }
        start().await
    }

    async fn spawn_codex(
        &self,
        app: &AppHandle,
        app_data: &Path,
    ) -> Result<RuntimeSnapshot, AppError> {
        // 安装由启动门禁负责，进程重启不得重复下载或触发无进度的自动更新。
        match CodexProcess::start(app_data).await {
            Ok(process) => {
                let messages = match process.connection().take_server_messages().await {
                    Ok(messages) => messages,
                    Err(error) => {
                        crate::infrastructure::diagnostics::record_error_chain(
                            "codex_event_stream_attach_failed",
                            &error,
                        );
                        self.fail_codex_start(app).await;
                        return Err(AppError::CodexRuntimeStartFailed);
                    }
                };
                let delivery = prepare_event_delivery(&self.runtime).await;
                let mut runtime = self.runtime.lock().await;
                runtime.codex_process = Some(process);
                runtime._event_task = Some(spawn_event_forwarder(
                    Arc::clone(&self.runtime),
                    messages,
                    Some(app.clone()),
                ));
                mark_runtime_started(&mut runtime);
                let event = runtime.transition(RuntimeStatus::Ready, Some(ProviderKind::Codex));
                let snapshot = runtime.snapshot;
                drop(runtime);
                delivery.send(event).await;
                Ok(snapshot)
            }
            Err(error) => {
                crate::infrastructure::diagnostics::record_error_chain(
                    "codex_runtime_start_failed",
                    &error,
                );
                self.fail_codex_start(app).await;
                Err(AppError::CodexRuntimeStartFailed)
            }
        }
    }

    async fn fail_codex_start(&self, app: &AppHandle) {
        let delivery = prepare_event_delivery(&self.runtime).await;
        let (generation, delay) = {
            let mut runtime = self.runtime.lock().await;
            runtime.codex_process = None;
            runtime.runtime_started_at = None;
            let event = runtime.transition(RuntimeStatus::Failed, Some(ProviderKind::Codex));
            let restart = prepare_runtime_restart(&mut runtime);
            drop(runtime);
            delivery.send(event).await;
            restart
        };
        schedule_runtime_restart(app.clone(), generation, delay);
    }
}
