use std::{collections::HashMap, future::Future, sync::Arc};

use tauri::ipc::Channel;
use tokio::sync::Mutex;

use super::error::AppError;
use super::request_cancellation::RequestCancellationRegistry;
#[path = "state_event_delivery.rs"]
mod event_delivery;
#[path = "state_event_stream.rs"]
mod event_stream;
use event_stream::RuntimeEventStream;
#[path = "state_event_diagnostics.rs"]
mod event_diagnostics;
#[path = "state_event_publisher.rs"]
mod event_publisher;
use event_delivery::prepare_event_delivery;
#[path = "state_performance_metrics.rs"]
pub(super) mod performance_metrics;
#[path = "state_task_activity.rs"]
mod task_activity_state;
use super::task_activity::TaskActivityState;
use crate::{domain::runtime::RuntimeSnapshot, infrastructure::workspace::ProjectFileSearch};
use performance_metrics::{RuntimePerformanceMetrics, RuntimePerformanceMetricsSnapshot};
#[derive(Default)]
pub struct AppState {
    pub acp: crate::application::acp_commands::AcpDesktopRuntime,
    pub(super) pending_resolutions: super::turn_start::TurnStartRegistry,
    pub(super) pending_resolution_budget: super::prompt_submission::SubmissionBudget,
    pub(super) submission_budget: super::prompt_submission::SubmissionBudget,
    pub(super) task_creations: super::task_creation::TaskCreationRegistry,
    pub terminals: crate::infrastructure::terminal::TerminalManager,
    file_search: ProjectFileSearch,
    request_cancellations: RequestCancellationRegistry,
    runtime: Arc<Mutex<RuntimeSession>>,
}

#[derive(Default)]
struct RuntimeSession {
    event_sender: Option<Arc<RuntimeEventStream>>,
    event_generation: u64,
    event_order: Arc<Mutex<()>>,
    snapshot: RuntimeSnapshot,
    project_sequences: HashMap<String, u64>,
    task_projects: HashMap<String, String>,
    task_activity: TaskActivityState,
    performance_metrics: RuntimePerformanceMetrics,
}

impl AppState {
    pub fn project_file_search(&self) -> &ProjectFileSearch {
        &self.file_search
    }

    pub(super) async fn run_cooperative<T, F, Fut>(&self, id: Option<&str>, task: F) -> T
    where
        F: FnOnce(tokio_util::sync::CancellationToken) -> Fut,
        Fut: Future<Output = T>,
    {
        self.request_cancellations.run_cooperative(id, task).await
    }
    pub fn cancel_request(&self, request_id: &str) -> bool {
        self.request_cancellations.cancel(request_id)
    }

    pub async fn run_cancellable<T, F>(
        &self,
        request_id: Option<&str>,
        task: F,
    ) -> Result<T, AppError>
    where
        F: Future<Output = Result<T, AppError>>,
    {
        self.request_cancellations
            .run(request_id, task)
            .await
            .ok_or(AppError::RequestCancelled)?
    }

    pub async fn runtime_performance_metrics(&self) -> RuntimePerformanceMetricsSnapshot {
        self.runtime.lock().await.performance_metrics.snapshot()
    }

    pub async fn connect(&self, event_channel: Channel) -> RuntimeSnapshot {
        let mut runtime = self.runtime.lock().await;

        // 只替换通道；事件序列化和 WebView 投递在状态锁外执行。
        runtime.set_event_channel(event_channel);
        runtime.snapshot
    }

    pub async fn acknowledge_runtime_events(&self, stream_id: u64, delivery_ids: &[u64]) {
        let sender = self.runtime.lock().await.event_sender.clone();
        if let Some(sender) = sender {
            sender.acknowledge(stream_id, delivery_ids);
        }
    }

    pub async fn remember_tasks<'a>(
        &self,
        project_id: &str,
        task_ids: impl IntoIterator<Item = &'a str>,
    ) {
        let mut runtime = self.runtime.lock().await;
        runtime
            .project_sequences
            .entry(project_id.to_owned())
            .or_default();
        for task_id in task_ids {
            runtime
                .task_projects
                .insert(task_id.to_owned(), project_id.to_owned());
        }
    }

    pub async fn project_sequence(&self, project_id: &str) -> u64 {
        *self
            .runtime
            .lock()
            .await
            .project_sequences
            .get(project_id)
            .unwrap_or(&0)
    }
}

impl RuntimeSession {
    fn set_event_channel(&mut self, channel: Channel) {
        if let Some(previous) = self.event_sender.take() {
            previous.close();
        }
        self.event_generation += 1;
        self.event_sender = Some(Arc::new(RuntimeEventStream::new(
            channel,
            self.event_generation,
        )));
    }
}

#[cfg(test)]
#[path = "state_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "state_stream_tests.rs"]
mod stream_tests;

#[cfg(test)]
#[path = "state_diagnostics_tests.rs"]
mod diagnostics_tests;

#[path = "state_catalog.rs"]
mod catalog_state;

// 每次桌面进程生成新标识，使客户端能识别重启后的事件序列。
pub(super) fn runtime_session_id() -> &'static str {
    static SESSION: std::sync::LazyLock<String> =
        std::sync::LazyLock::new(|| uuid::Uuid::new_v4().to_string());
    SESSION.as_str()
}
