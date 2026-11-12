use std::{future::Future, sync::Arc};
use tokio::sync::{Mutex, Notify, RwLock, RwLockReadGuard};
use tokio_util::sync::CancellationToken;
#[derive(Default)]
struct State {
    closed: bool,
    task: Option<tauri::async_runtime::JoinHandle<()>>,
}
#[derive(Clone, Default)]
pub struct AcpPlanRuntime {
    state: Arc<Mutex<State>>,
    requests: Arc<RwLock<()>>,
    wake: Arc<Notify>,
    stop: CancellationToken,
}
impl AcpPlanRuntime {
    async fn start_with<F, Fut>(&self, f: F) -> bool
    where
        F: FnOnce(Arc<Notify>, CancellationToken) -> Fut + Send + 'static,
        Fut: Future<Output = ()> + Send + 'static,
    {
        let mut state = self.state.lock().await;
        if self.stop.is_cancelled()
            || state.closed
            || state
                .task
                .as_ref()
                .is_some_and(|task| !task.inner().is_finished())
        {
            return false;
        }
        let wake = self.wake.clone();
        let stop = self.stop.clone();
        state.task = Some(tauri::async_runtime::spawn(async move {
            f(wake, stop).await;
        }));
        true
    }
    pub async fn close(&self) {
        self.stop.cancel();
        let _requests = self.requests.write().await;
        let mut state = self.state.lock().await;
        state.closed = true;
        self.stop.cancel();
        // 持有生命周期锁等待任务归还控制权；并发 close 同样等待，不能先关闭 ACP 或数据库。
        if let Some(task) = state.task.take() {
            let _ = task.await;
        }
    }
    pub(super) async fn enter(&self) -> Result<RwLockReadGuard<'_, ()>, super::error::AppError> {
        if self.is_closed() {
            return Err(super::error::AppError::ScheduledTaskBusy);
        }
        let guard = self.requests.read().await;
        if self.is_closed() {
            return Err(super::error::AppError::ScheduledTaskBusy);
        }
        Ok(guard)
    }
    pub(super) fn wake(&self) {
        self.wake.notify_one();
    }
    pub(super) fn is_closed(&self) -> bool {
        self.stop.is_cancelled()
    }
    pub async fn start(&self, app: tauri::AppHandle) {
        self.start_with(move |wake, stop| async move {
            let result = async {
                let directory = crate::infrastructure::app_data::directory(&app)
                    .map_err(|_| super::error::AppError::FilesystemRequestFailed)?;
                let store = crate::infrastructure::local_catalog::LocalCatalog::at(&directory)?;
                super::acp_plan_scheduler::run(
                    &store,
                    |id, run| {
                        let app = app.clone();
                        async move { super::acp_plan_executor::execute(app, &id, &run).await }
                    },
                    &wake,
                    &stop,
                    || chrono::Utc::now().timestamp_millis(),
                    |error| {
                        crate::infrastructure::diagnostics::record_error(
                            "acp_plan_scheduler",
                            error.to_string(),
                        );
                    },
                )
                .await
            }
            .await;
            if let Err(error) = result {
                crate::infrastructure::diagnostics::record_error(
                    "acp_plan_scheduler",
                    error.to_string(),
                );
            }
        })
        .await;
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn close_should_wait_for_plan_requests_and_refuse_new_ones() {
        let runtime = AcpPlanRuntime::default();
        let request = runtime.enter().await.unwrap();
        let closing = runtime.clone();
        let close = tokio::spawn(async move { closing.close().await });
        tokio::task::yield_now().await;
        assert!(!close.is_finished());
        assert!(runtime.enter().await.is_err());
        drop(request);
        close.await.unwrap();
    }
    #[tokio::test]
    async fn runtime_should_start_once_and_wait_for_inflight_on_close() {
        let runtime = AcpPlanRuntime::default();
        let (entered, ready) = tokio::sync::oneshot::channel();
        let (release, wait) = tokio::sync::oneshot::channel();
        assert!(
            runtime
                .start_with(move |_, stop| async move {
                    let _ = entered.send(());
                    stop.cancelled().await;
                    let _ = wait.await;
                })
                .await
        );
        ready.await.unwrap();
        assert!(
            !runtime
                .start_with(|_, _| async { panic!("duplicate") })
                .await
        );
        let closing = runtime.clone();
        let task = tokio::spawn(async move { closing.close().await });
        tokio::task::yield_now().await;
        assert!(!task.is_finished());
        release.send(()).unwrap();
        task.await.unwrap();
        assert!(!runtime.start_with(|_, _| async {}).await);
        runtime.close().await;
    }
}
