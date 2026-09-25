use super::super::error::AppError;
use super::super::turn_start::TurnStartRegistry;
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tokio::sync::Mutex as AsyncMutex;

const CAPACITY: usize = 128;
const RETENTION: Duration = Duration::from_secs(15 * 60);

#[derive(Default)]
pub(crate) struct QueuedSteerRegistry {
    pub(super) starts: TurnStartRegistry,
    entries: Mutex<HashMap<[u8; 32], Entry>>,
}

struct Entry {
    created: Instant,
    state: Arc<AsyncMutex<RecoveryState>>,
}

#[derive(Default)]
pub(super) struct RecoveryState {
    pub idle_start_attempted: bool,
    pub first_key: Option<String>,
    pub accepted: Option<Accepted>,
}

pub(super) struct Accepted {
    pub content: [u8; 32],
    // 保存有界编码结果，不保留完整提示词或展开后的 JSON 对象。
    pub result: Vec<u8>,
}

pub(super) fn uncertain() -> Value {
    json!({"code":"TURN_START_UNCERTAIN", "message":"Queued steer acceptance is unconfirmed; retry the original attempt or inspect the task before removing the queued item"})
}

impl QueuedSteerRegistry {
    pub(crate) async fn reserve_idle_start(
        &self,
        project: &str,
        task: &str,
        id: &str,
    ) -> Result<Option<IdleStartLease>, AppError> {
        let identity = super::super::turn_start::fingerprint_queue_start(project, task, Some(id))
            .map_err(|_| AppError::QueueRecoveryUncertain)?
            .digest();
        let slot = self.acquire(identity)?;
        let mut guard = tokio::time::timeout(Duration::from_secs(120), slot.lock_owned())
            .await
            .map_err(|_| AppError::QueueRecoveryUncertain)?;
        if guard.accepted.is_some() {
            return Ok(None);
        }
        if guard.idle_start_attempted || guard.first_key.is_some() {
            return Err(AppError::QueueRecoveryUncertain);
        }
        // 在同项锁内认领消费；即使 RPC 结果丢失，后来的新键也不能再追加或启动。
        guard.idle_start_attempted = true;
        Ok(Some(IdleStartLease { _guard: guard }))
    }

    pub(crate) async fn accepted_for_queue(
        &self,
        project_id: &str,
        task_id: &str,
        submission_id: &str,
    ) -> Result<Option<CleanupLease>, super::super::error::AppError> {
        use super::super::{error::AppError, turn_start::fingerprint_queue_start};
        let identity = fingerprint_queue_start(project_id, task_id, Some(submission_id))
            .map_err(|_| AppError::QueueRecoveryUncertain)?
            .digest();
        let slot = {
            let entries = self
                .entries
                .lock()
                .map_err(|_| AppError::QueueRecoveryUncertain)?;
            entries
                .get(&identity)
                .filter(|entry| {
                    entry.created.elapsed() < RETENTION || Arc::strong_count(&entry.state) > 1
                })
                .map(|entry| Arc::clone(&entry.state))
        };
        let Some(slot) = slot else {
            return Ok(None);
        };
        let guard = tokio::time::timeout(Duration::from_secs(120), slot.lock_owned())
            .await
            .map_err(|_| AppError::QueueRecoveryUncertain)?;
        let content = guard
            .accepted
            .as_ref()
            .ok_or(AppError::QueueRecoveryUncertain)?
            .content;
        Ok(Some(CleanupLease {
            content,
            _guard: guard,
        }))
    }

    pub(super) fn acquire(
        &self,
        identity: [u8; 32],
    ) -> Result<Arc<AsyncMutex<RecoveryState>>, AppError> {
        let mut entries = self
            .entries
            .lock()
            .map_err(|_| AppError::QueueRecoveryUncertain)?;
        // 调用方和追加 worker 均持有租约，仍在执行的队列项不能过期后重新追加。
        entries.retain(|_, entry| {
            entry.created.elapsed() < RETENTION || Arc::strong_count(&entry.state) > 1
        });
        if let Some(entry) = entries.get(&identity) {
            return Ok(Arc::clone(&entry.state));
        }
        if entries.len() >= CAPACITY {
            return Err(AppError::QueueRecoveryCapacityExceeded);
        }
        let state = Arc::new(AsyncMutex::new(RecoveryState::default()));
        entries.insert(
            identity,
            Entry {
                created: Instant::now(),
                state: Arc::clone(&state),
            },
        );
        Ok(state)
    }
}

pub(crate) struct IdleStartLease {
    // 必须由启动 worker 持有到 RPC 和原生收尾完成，不能在选择阶段就释放。
    _guard: tokio::sync::OwnedMutexGuard<RecoveryState>,
}

pub(crate) struct CleanupLease {
    pub content: [u8; 32],
    // 持有同项协调锁与租约，核对内容和删除期间不能淘汰已接受事实。
    _guard: tokio::sync::OwnedMutexGuard<RecoveryState>,
}

#[cfg(test)]
#[path = "queued_steer_recovery_tests.rs"]
mod tests;
