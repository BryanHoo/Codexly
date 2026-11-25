use serde_json::{Value, json};
use std::sync::Arc;
use tokio::sync::{OwnedSemaphorePermit, Semaphore};

pub struct SubmissionBudget {
    requests: Arc<Semaphore>,
    bytes: Arc<Semaphore>,
}

impl Default for SubmissionBudget {
    fn default() -> Self {
        Self {
            requests: Arc::new(Semaphore::new(16)),
            bytes: Arc::new(Semaphore::new(8 * 1024 * 1024)),
        }
    }
}

impl SubmissionBudget {
    pub(super) fn reserve(
        &self,
        bytes: usize,
    ) -> Result<(OwnedSemaphorePermit, OwnedSemaphorePermit), Value> {
        let exhausted = || json!({"code": "IDEMPOTENCY_CAPACITY_EXCEEDED", "message": "Task submission capacity is exhausted; retry later"});
        let bytes = u32::try_from(bytes).map_err(|_| exhausted())?;
        // 不排队保留输入；任一预算不足立即拒绝，已取得的许可自动释放。
        let request = Arc::clone(&self.requests)
            .try_acquire_owned()
            .map_err(|_| exhausted())?;
        let input = Arc::clone(&self.bytes)
            .try_acquire_many_owned(bytes)
            .map_err(|_| exhausted())?;
        Ok((request, input))
    }
}
