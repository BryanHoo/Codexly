mod process;
#[cfg(test)]
mod tests;
mod transport;
mod workers;

use crate::application::{error::AppError, state::AppState};
use crate::infrastructure::claude_runtime::{ClaudeRuntimeManager, RuntimePaths};
use crate::infrastructure::local_catalog::LocalCatalog;
use serde_json::{Value, json};
use std::{process::Stdio, sync::Arc, time::Duration};
use tauri::AppHandle;
use tokio::{
    process::{Child, Command},
    sync::{Mutex, mpsc},
    task::JoinSet,
    time::{Instant, timeout_at},
};
use tokio_util::sync::CancellationToken;
use transport::{LANES, Transport};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(45);
pub fn normalize_item(item: &mut Value) {
    if item["type"] == "reasoning" {
        let text = item["content"].as_str().unwrap_or_default().to_owned();
        let id = item["id"].clone();
        *item = json!({"id":id,"type":"reasoning","text":text});
    }
}
pub fn normalize_event(event: &mut Value) {
    if event["type"] == "reasoning.delta" {
        event["payload"] = json!({"delta":event["payload"]["delta"]});
    }
    if let Some(item) = event.pointer_mut("/payload/item") {
        normalize_item(item);
    }
    if let Some(items) = event
        .pointer_mut("/payload/turn/items")
        .and_then(Value::as_array_mut)
    {
        for item in items {
            normalize_item(item);
        }
    }
}

#[derive(Default)]
pub struct ClaudeHostManager {
    host: Mutex<Option<Arc<ClaudeHost>>>,
    pub(crate) runtime: ClaudeRuntimeManager,
}
struct ClaudeHost {
    child: Arc<Mutex<Child>>,
    transport: Arc<Transport>,
    finished: CancellationToken,
}

impl ClaudeHostManager {
    pub async fn request(
        &self,
        app: &AppHandle,
        method: &str,
        scope: Option<Value>,
        params: Value,
    ) -> Result<Value, AppError> {
        // 从管理器排队开始计算同一个绝对时限；启动、写入和等待响应都不得重置计时。
        let deadline = Instant::now() + REQUEST_TIMEOUT;
        let operation = async {
            let host = {
                let mut current = self.host.lock().await;
                let alive = if let Some(host) = current.as_ref() {
                    !host.transport.stopped.is_cancelled()
                        && host
                            .child
                            .lock()
                            .await
                            .try_wait()
                            .map_err(failure)?
                            .is_none()
                } else {
                    false
                };
                if !alive {
                    if let Some(old) = current.take() {
                        old.close().await;
                    }
                    let resources = crate::infrastructure::bundled_runtime::root(app)?;
                    let paths = self
                        .runtime
                        .prepare(
                            &resources,
                            crate::infrastructure::bundled_runtime::claude_host()?,
                            |_| {},
                        )
                        .await
                        .map_err(failure)?;
                    *current = Some(Arc::new(ClaudeHost::start(app, paths).await?));
                }
                Arc::clone(
                    current
                        .as_ref()
                        .ok_or_else(|| failure("Claude host unavailable"))?,
                )
            };
            host.transport
                .request(method, scope, params, deadline)
                .await
                .map_err(failure)
        };
        timeout_at(deadline, operation)
            .await
            .map_err(|_| failure("Claude host request timed out"))?
    }

    pub async fn close(&self) {
        if let Some(host) = self.host.lock().await.take() {
            host.close().await;
        }
    }
}

fn failure(error: impl std::fmt::Display) -> AppError {
    AppError::Claude(error.to_string())
}

impl ClaudeHost {
    async fn start(app: &AppHandle, (binary, host_path): RuntimePaths) -> Result<Self, AppError> {
        let app_data = crate::infrastructure::app_data::directory(app).map_err(failure)?;
        let catalog = LocalCatalog::at(&app_data)?;
        let mut command = Command::new(host_path);
        command
            .env("CODEXLY_APPLICATION_GENERATION", "1")
            .arg(app_data.join("engines/claude"))
            .arg(binary)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        process::ProcessGuard::configure(&mut command);
        let mut child = command.spawn().map_err(failure)?;
        let process_guard = process::ProcessGuard::attach(&child).map_err(failure)?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| failure("Claude host stdin unavailable"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| failure("Claude host stdout unavailable"))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| failure("Claude host stderr unavailable"))?;
        let child = Arc::new(Mutex::new(child));
        let (transport, writes) = Transport::new();
        let (catalog_sender, catalog_receiver) = mpsc::channel(64);
        let mut tasks = JoinSet::new();
        tasks.spawn(transport::writer_loop(
            stdin,
            writes,
            Arc::clone(&transport),
        ));
        tasks.spawn(workers::catalog_loop(
            catalog_receiver,
            catalog.clone(),
            Arc::clone(&transport),
            Some(app.clone()),
        ));
        let tail: workers::StderrTail = Arc::default();
        tasks.spawn(workers::stderr_loop(stderr, Arc::clone(&tail)));
        let mut lanes = Vec::with_capacity(LANES);
        for _ in 0..LANES {
            let (sender, receiver) = mpsc::channel(64);
            lanes.push(sender);
            tasks.spawn(workers::event_loop(
                receiver,
                app.clone(),
                Arc::clone(&transport),
            ));
        }
        tasks.spawn(transport::reader_loop(
            stdout,
            Arc::clone(&transport),
            catalog_sender,
            lanes,
        ));
        let finished = CancellationToken::new();
        let host = Self {
            child: Arc::clone(&child),
            transport: Arc::clone(&transport),
            finished: finished.clone(),
        };
        let app = app.clone();
        // 唯一监督任务拥有全部固定 worker。任何 worker 退出/崩溃都使宿主失效并回收进程。
        tokio::spawn(async move {
            tokio::select! {
                biased;
                _ = transport.stopped.cancelled() => {},
                _ = tasks.join_next() => transport.fail("Claude host worker stopped"),
            }
            tasks.abort_all();
            while tasks.join_next().await.is_some() {}
            process_guard.shutdown(&mut *child.lock().await).await;
            let diagnostic = tail
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .iter()
                .cloned()
                .collect::<Vec<_>>()
                .join("; ");
            if !diagnostic.is_empty() {
                crate::infrastructure::diagnostics::record_error(
                    "claude_host_stderr_tail",
                    diagnostic,
                );
            }
            // 清理旧连接投影后才允许重建；上限避免原生后处理拖住退出。
            if tokio::time::timeout(
                Duration::from_secs(3),
                workers::fail_active_turns(&app, &catalog, &transport),
            )
            .await
            .is_err()
            {
                crate::infrastructure::diagnostics::record_error(
                    "claude_host_failure_cleanup_timed_out",
                    "failure projection or catalog persistence timed out",
                );
            }
            finished.cancel();
        });
        Ok(host)
    }

    async fn close(&self) {
        self.transport.fail("Claude host closed");
        self.finished.cancelled().await;
    }
}

impl Drop for ClaudeHost {
    fn drop(&mut self) {
        self.transport.fail("Claude host released");
    }
}

pub(super) async fn snapshot_response(state: &AppState, project: &str, snapshot: Value) -> Value {
    let sequence = state.project_sequence(project).await;
    json!({"snapshot":snapshot,"checkpoint":{"sequence":sequence,
        "sessionId":crate::infrastructure::codex::runtime_session_id()}})
}
