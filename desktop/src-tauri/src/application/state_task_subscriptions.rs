use super::AppState;

impl AppState {
    pub(crate) async fn complete_task_subscription_release(&self, task_id: &str, generation: u64) {
        self.runtime
            .lock()
            .await
            .task_subscription_leases
            .complete(task_id, generation);
    }

    pub(crate) async fn is_task_subscription_release_current(
        &self,
        task_id: &str,
        generation: u64,
    ) -> bool {
        self.runtime
            .lock()
            .await
            .task_subscription_leases
            .is_current(task_id, generation)
    }

    pub(crate) async fn release_task_subscription(&self, task_id: &str) -> u64 {
        self.runtime
            .lock()
            .await
            .task_subscription_leases
            .release(task_id)
    }

    pub(crate) async fn retain_task_subscription(&self, task_id: &str) {
        self.runtime
            .lock()
            .await
            .task_subscription_leases
            .retain(task_id);
    }
}
