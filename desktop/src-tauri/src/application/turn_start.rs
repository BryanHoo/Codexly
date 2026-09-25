use super::error::AppError;
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

#[path = "turn_start_payload.rs"]
mod payload;
use payload::{TurnStartIdentity, encode_result};
pub use payload::{
    fingerprint, fingerprint_pending_resolution, fingerprint_queue_content,
    fingerprint_queue_start, fingerprint_queued_steer, fingerprint_review, fingerprint_steer,
};

pub type TurnStartResult = Result<Value, Value>;
type StoredResult = Arc<[u8]>;
const CAPACITY: usize = 128;
const MAX_INFLIGHT_BYTES: usize = 8 * 1024 * 1024;
const RETENTION: Duration = Duration::from_secs(15 * 60);
const WAIT_TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Default)]
pub struct TurnStartRegistry {
    entries: Mutex<HashMap<String, Entry>>,
}

struct Entry {
    identity: TurnStartIdentity,
    started: Instant,
    result: watch::Receiver<Option<StoredResult>>,
    retry_allowed: Arc<AtomicBool>,
}

impl Entry {
    fn in_flight(&self) -> bool {
        self.result.borrow().is_none() && self.result.has_changed().is_ok()
    }
}

fn error(code: &str, message: &str) -> Value {
    json!({"code": code, "message": message})
}

fn unavailable() -> Value {
    error(
        "TURN_START_UNCERTAIN",
        "Turn start result is unavailable; refresh the task before starting a new attempt",
    )
}

impl TurnStartRegistry {
    pub(super) fn check_identity(
        &self,
        key: &str,
        identity: &TurnStartIdentity,
    ) -> Result<(), Value> {
        if key.trim().is_empty() || key.len() > 128 {
            return Err(error(
                "INVALID_REQUEST",
                "Turn start requires a bounded idempotency key",
            ));
        }
        let entries = self.entries.lock().map_err(|_| unavailable())?;
        if entries.get(key).is_some_and(|entry| {
            (entry.started.elapsed() < RETENTION || entry.in_flight())
                && entry.identity.digest != identity.digest
        }) {
            return Err(error(
                "IDEMPOTENCY_CONFLICT",
                "Turn start key belongs to a different request",
            ));
        }
        Ok(())
    }

    pub async fn run<F>(&self, key: &str, identity: TurnStartIdentity, start: F) -> TurnStartResult
    where
        F: Future<Output = Result<Value, AppError>> + Send + 'static,
    {
        if key.trim().is_empty() || key.len() > 128 {
            return Err(error(
                "INVALID_REQUEST",
                "Turn start requires a bounded idempotency key",
            ));
        }
        let receiver = {
            let mut entries = self.entries.lock().map_err(|_| unavailable())?;
            // 未结束的执行不因保留窗口到期而允许重跑；只按需回收过期完成项。
            entries.retain(|_, entry| entry.started.elapsed() < RETENTION || entry.in_flight());
            let retained = if let Some(entry) = entries.get(key) {
                if entry.identity.digest != identity.digest {
                    return Err(error(
                        "IDEMPOTENCY_CONFLICT",
                        "Turn start key belongs to a different request",
                    ));
                }
                // 即使允许重新取得连接，也不能复用键更改项目、任务或输入。
                (!(entry.result.borrow().is_some() && entry.retry_allowed.load(Ordering::Acquire)))
                    .then(|| entry.result.clone())
            } else {
                None
            };
            if let Some(receiver) = retained {
                receiver
            } else {
                let pending_bytes: usize = entries
                    .values()
                    .filter(|entry| entry.in_flight())
                    .map(|entry| entry.identity.bytes)
                    .sum();
                if (entries.len() >= CAPACITY && !entries.contains_key(key))
                    || identity.bytes > MAX_INFLIGHT_BYTES.saturating_sub(pending_bytes)
                {
                    return Err(error(
                        "IDEMPOTENCY_CAPACITY_EXCEEDED",
                        "Turn start request capacity is exhausted; retry later",
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
                        identity,
                        started,
                        result: receiver.clone(),
                        retry_allowed: Arc::clone(&retry_allowed),
                    },
                );
                // 登记先于任何副作用；WebView 取消等待不取消已经开始的启动或 Goal 等待。
                tokio::spawn(async move {
                    let result = start.await;
                    // 仅重试可证明尚未消费的原生失败；传输/RPC 错误仍重放原结果。
                    retry_allowed.store(
                        matches!(
                            &result,
                            Err(AppError::CodexRuntimeUnavailable
                                | AppError::QueueRecoveryCapacityExceeded)
                        ),
                        Ordering::Release,
                    );
                    let result = result.map_err(|error| {
                        serde_json::to_value(error).unwrap_or_else(|_| unavailable())
                    });
                    sender.send_replace(Some(encode_result(&result)));
                });
                receiver
            }
        };
        wait_for_result(receiver, WAIT_TIMEOUT).await
    }
}

async fn wait_for_result(
    mut receiver: watch::Receiver<Option<StoredResult>>,
    timeout: Duration,
) -> TurnStartResult {
    tokio::time::timeout(timeout, async {
        loop {
            // 锁内只克隆 Arc；解析在锁外进行，多个等待者共享一份有界编码结果。
            let result = receiver.borrow().clone();
            if let Some(result) = result {
                return serde_json::from_slice(&result).map_err(|_| unavailable())?;
            }
            receiver.changed().await.map_err(|_| unavailable())?;
        }
    })
    .await
    .map_err(|_| unavailable())?
}

#[cfg(test)]
#[path = "turn_start_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "turn_start_rpc_tests.rs"]
mod rpc_tests;
