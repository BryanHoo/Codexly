use super::error::AppError;
use crate::domain::sidebar::AgentTaskMutationResponse;
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    future::Future,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};
use tokio::sync::watch;

pub type CreationResult = Result<AgentTaskMutationResponse, Value>;

#[derive(Default)]
pub struct TaskCreationRegistry {
    entries: Mutex<HashMap<String, Entry>>,
}

const CAPACITY: usize = 128;
const MAX_RESULT_BYTES: usize = 8192;
const RETENTION: Duration = Duration::from_secs(15 * 60);
const WAIT_TIMEOUT: Duration = Duration::from_secs(120);

struct Entry {
    project_id: String,
    started: Instant,
    result: watch::Receiver<Option<CreationResult>>,
    retry_allowed: Arc<AtomicBool>,
}

fn error(code: &str, message: &str) -> Value {
    json!({"code":code,"message":message})
}

fn unavailable() -> Value {
    error(
        "TASK_CREATION_UNCERTAIN",
        "Task creation result is unavailable; refresh the task list before starting a new attempt",
    )
}

impl TaskCreationRegistry {
    pub async fn run<F>(&self, project_id: &str, key: &str, create: F) -> CreationResult
    where
        F: Future<Output = Result<AgentTaskMutationResponse, AppError>> + Send + 'static,
    {
        if key.trim().is_empty()
            || key.len() > 128
            || project_id.is_empty()
            || project_id.len() > 1024
        {
            return Err(error(
                "INVALID_REQUEST",
                "Task creation requires a bounded project identity and idempotency key",
            ));
        }
        let mut receiver = {
            let mut entries = self.entries.lock().map_err(|_| unavailable())?;
            // 只在请求时清理过期完成项；不能淘汰在途或仍在承诺窗口内的记录。
            entries.retain(|_, entry| {
                entry.started.elapsed() < RETENTION
                    || (entry.result.borrow().is_none() && entry.result.has_changed().is_ok())
            });
            let retained = if let Some(entry) = entries.get(key) {
                if entry.project_id != project_id {
                    return Err(error(
                        "IDEMPOTENCY_CONFLICT",
                        "Task creation key belongs to another project",
                    ));
                }
                // 保留身份约束；只替换已完成且原生确认未取得运行时连接的尝试。
                (!(entry.result.borrow().is_some() && entry.retry_allowed.load(Ordering::Acquire)))
                    .then(|| entry.result.clone())
            } else {
                None
            };
            if let Some(receiver) = retained {
                receiver
            } else {
                if entries.len() >= CAPACITY && !entries.contains_key(key) {
                    return Err(error(
                        "IDEMPOTENCY_CAPACITY_EXCEEDED",
                        "Task creation request capacity is exhausted; retry later",
                    ));
                }
                let (sender, receiver) = watch::channel(None);
                let retry_allowed = Arc::new(AtomicBool::new(false));
                let started = entries
                    .get(key)
                    .map_or_else(Instant::now, |entry| entry.started);
                entries.insert(
                    key.to_owned(),
                    Entry {
                        project_id: project_id.to_owned(),
                        started,
                        result: receiver.clone(),
                        retry_allowed: Arc::clone(&retry_allowed),
                    },
                );
                // 工作独立于 WebView invoke 的等待者，取消等待不会使已开始的创建再次执行。
                tokio::spawn(async move {
                    let result = create.await;
                    // 此类型只由取得运行时之前的检查返回，不能按 RPC 错误文案推断安全重试。
                    retry_allowed.store(
                        matches!(&result, Err(AppError::CodexRuntimeUnavailable)),
                        Ordering::Release,
                    );
                    let result = result.map_err(|error| {
                        serde_json::to_value(error).unwrap_or_else(|_| unavailable())
                    });
                    let bytes = match &result {
                        Ok(response) => {
                            let task = &response.task;
                            task.id.len()
                                + task.project_id.len()
                                + task.title.len()
                                + task.updated_at.len()
                        }
                        Err(error) => error.to_string().len(),
                    };
                    // 超大结果保留失败墓碑，不能为了释放正文而允许同键重新创建。
                    sender.send_replace(Some(if bytes <= MAX_RESULT_BYTES {
                        result
                    } else {
                        Err(unavailable())
                    }));
                });
                receiver
            }
        };
        // 超时只结束等待，不取消可能已创建线程的工作区绑定与收尾。
        tokio::time::timeout(WAIT_TIMEOUT, async {
            loop {
                if let Some(result) = receiver.borrow().clone() {
                    return result;
                }
                // 工作异常退出时保留原记录并显式报告不确定，禁止接管后重跑副作用。
                receiver.changed().await.map_err(|_| unavailable())?;
            }
        })
        .await
        .map_err(|_| unavailable())?
    }
}

#[cfg(test)]
#[path = "task_creation_tests.rs"]
mod tests;
