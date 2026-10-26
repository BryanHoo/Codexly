use std::{
    collections::HashMap,
    sync::{Arc, Mutex, Weak},
};
use tokio::sync::{Mutex as AsyncMutex, OwnedMutexGuard};

use super::{AppServerConnection, ConnectionError};

#[derive(Default)]
pub(super) struct TaskSubscriptionOperations(Mutex<HashMap<String, Weak<AsyncMutex<()>>>>);

impl AppServerConnection {
    /// 同一任务的退订检查、恢复及回合启动共用临界区，避免旧 idle 结果切断新回合输出。
    pub async fn lock_task_subscription(
        &self,
        task_id: &str,
    ) -> Result<OwnedMutexGuard<()>, ConnectionError> {
        let lock = {
            let mut locks = self
                .task_subscription_operations
                .0
                .lock()
                .map_err(|_| ConnectionError::StateUnavailable)?;
            // 只保留执行中或等待中的操作，历史任务不会使锁表永久增长。
            locks.retain(|_, lock| lock.strong_count() > 0);
            if let Some(lock) = locks.get(task_id).and_then(Weak::upgrade) {
                lock
            } else {
                let lock = Arc::new(AsyncMutex::new(()));
                locks.insert(task_id.to_owned(), Arc::downgrade(&lock));
                lock
            }
        };
        Ok(lock.lock_owned().await)
    }
}
