use std::collections::HashMap;

use serde_json::Value;
use tokio::sync::oneshot;

#[derive(Default)]
pub(super) struct TurnStartedWaiters {
    next_id: u64,
    by_task: HashMap<String, Vec<(u64, oneshot::Sender<Value>)>>,
}

impl TurnStartedWaiters {
    pub(super) fn register(&mut self, task_id: &str) -> (u64, oneshot::Receiver<Value>) {
        self.next_id = self.next_id.wrapping_add(1).max(1);
        let id = self.next_id;
        let (sender, receiver) = oneshot::channel();
        self.by_task
            .entry(task_id.to_owned())
            .or_default()
            .push((id, sender));
        (id, receiver)
    }

    pub(super) fn resolve(&mut self, task_id: &str, turn: &Value) {
        if let Some(waiters) = self.by_task.remove(task_id) {
            for (_, sender) in waiters {
                let _ = sender.send(turn.clone());
            }
        }
    }

    pub(super) fn cancel(&mut self, task_id: &str, waiter_id: u64) {
        let Some(waiters) = self.by_task.get_mut(task_id) else {
            return;
        };
        waiters.retain(|(id, _)| *id != waiter_id);
        if waiters.is_empty() {
            self.by_task.remove(task_id);
        }
    }

    pub(super) fn clear(&mut self) {
        self.by_task.clear();
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::TurnStartedWaiters;

    #[tokio::test]
    async fn waiter_should_resolve_once_for_matching_task() {
        let mut waiters = TurnStartedWaiters::default();
        let (_, receiver) = waiters.register("thread-a");
        waiters.resolve("thread-a", &json!({"id": "turn-a"}));
        assert_eq!(receiver.await.unwrap(), json!({"id": "turn-a"}));
    }
}
