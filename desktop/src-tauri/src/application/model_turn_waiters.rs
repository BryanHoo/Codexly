use std::collections::HashMap;

use serde_json::Value;
use tokio::sync::oneshot;

struct ModelTurnWaiter {
    message: Option<String>,
    sender: oneshot::Sender<Option<String>>,
}

#[derive(Default)]
pub(super) struct ModelTurnWaiters {
    by_thread: HashMap<String, ModelTurnWaiter>,
}

impl ModelTurnWaiters {
    pub(super) fn register(&mut self, thread_id: &str) -> oneshot::Receiver<Option<String>> {
        let (sender, receiver) = oneshot::channel();
        self.by_thread.insert(
            thread_id.to_owned(),
            ModelTurnWaiter {
                message: None,
                sender,
            },
        );
        receiver
    }

    pub(super) fn observe(&mut self, method: &str, params: &Value) {
        let Some(thread_id) = params.get("threadId").and_then(Value::as_str) else {
            return;
        };
        if method == "item/completed" {
            let Some(waiter) = self.by_thread.get_mut(thread_id) else {
                return;
            };
            let item = &params["item"];
            if item.get("type").and_then(Value::as_str) == Some("agentMessage")
                && let Some(message) = item.get("text").and_then(Value::as_str)
                && !message.trim().is_empty()
            {
                waiter.message = Some(message.to_owned());
            }
            return;
        }
        if method == "turn/completed"
            && let Some(waiter) = self.by_thread.remove(thread_id)
        {
            let completed =
                params.pointer("/turn/status").and_then(Value::as_str) == Some("completed");
            let _ = waiter
                .sender
                .send(completed.then_some(waiter.message).flatten());
        }
    }

    pub(super) fn cancel(&mut self, thread_id: &str) {
        self.by_thread.remove(thread_id);
    }

    pub(super) fn clear(&mut self) {
        self.by_thread.clear();
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::ModelTurnWaiters;

    #[tokio::test]
    async fn waiter_should_resolve_final_agent_message_after_completed_turn() {
        let mut waiters = ModelTurnWaiters::default();
        let receiver = waiters.register("thread-message");
        waiters.observe(
            "item/completed",
            &json!({
                "threadId": "thread-message",
                "item": {"type": "agentMessage", "text": "fix(core): 修复状态"}
            }),
        );
        waiters.observe(
            "turn/completed",
            &json!({"threadId": "thread-message", "turn": {"status": "completed"}}),
        );

        assert_eq!(
            receiver.await.unwrap().as_deref(),
            Some("fix(core): 修复状态")
        );
    }
}
