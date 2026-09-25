use std::collections::{HashSet, VecDeque};

use serde::Deserialize;

use super::connection::ServerMessage;
use super::connection_message_channel::message_bytes;

const NOTIFICATION_BYTES: usize = 8 * 1024 * 1024;
const RESYNC_BYTES: usize = 64 * 1024;
const RESYNC_COUNT: usize = 256;

pub(crate) const EVENT_RETENTION_EXCEEDED_METHOD: &str = "codeagent/eventRetentionExceeded";

const RECOVERABLE_DELTA_METHODS: &[&str] = &[
    "item/agentMessage/delta",
    "item/commandExecution/outputDelta",
    "item/plan/delta",
    "item/reasoning/summaryTextDelta",
];

const IGNORED_REASONING_METHODS: &[&str] = &[
    "item/reasoning/textDelta",
    "item/reasoning/summaryPartAdded",
];

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaskScope<'a> {
    thread_id: &'a str,
}

pub(super) struct NotificationBuffer {
    capacity: usize,
    notifications: VecDeque<ServerMessage>,
    pending_resyncs: VecDeque<(String, ServerMessage)>,
    resync_task_ids: HashSet<String>,
    bytes: usize,
    resync_bytes: usize,
}

impl NotificationBuffer {
    pub(super) fn new(capacity: usize) -> Self {
        Self {
            capacity,
            notifications: VecDeque::with_capacity(capacity),
            pending_resyncs: VecDeque::new(),
            resync_task_ids: HashSet::new(),
            bytes: 0,
            resync_bytes: 0,
        }
    }

    pub(super) fn is_empty(&self) -> bool {
        self.pending_resyncs.is_empty() && self.notifications.is_empty()
    }

    pub(super) fn clear(&mut self) {
        self.notifications.clear();
        self.pending_resyncs.clear();
        self.resync_task_ids.clear();
        self.bytes = 0;
        self.resync_bytes = 0;
    }

    pub(super) fn pop_front(&mut self) -> Option<ServerMessage> {
        if let Some((task_id, message)) = self.pending_resyncs.pop_front() {
            self.resync_task_ids.remove(&task_id);
            self.resync_bytes -= task_id.len() * 2 + message_bytes(&message);
            return Some(message);
        }
        let message = self.notifications.pop_front()?;
        self.bytes -= message_bytes(&message);
        Some(message)
    }

    pub(super) fn next_bytes(&self) -> usize {
        self.pending_resyncs
            .front()
            .map(|(_, message)| message)
            .or_else(|| self.notifications.front())
            .map_or(0, message_bytes)
    }

    pub(super) fn push(&mut self, message: ServerMessage) -> bool {
        // 原始推理内容不入队；摘要 Delta 按可恢复事件处理。
        if is_ignored_reasoning_notification(&message) {
            return true;
        }

        let size = message_bytes(&message);
        if self.notifications.len() < self.capacity && self.bytes + size <= NOTIFICATION_BYTES {
            self.bytes += size;
            self.notifications.push_back(message);
            return true;
        }

        if is_recoverable_delta(&message) {
            return self.record_dropped_delta(message);
        }

        while self.notifications.len() >= self.capacity || self.bytes + size > NOTIFICATION_BYTES {
            let Some(index) = self.notifications.iter().position(is_recoverable_delta) else {
                // 无可恢复增量可淘汰时拒绝继续扩容，调用方必须显式终止并恢复连接。
                return false;
            };
            let Some(dropped) = self.notifications.remove(index) else {
                return false;
            };
            self.bytes -= message_bytes(&dropped);
            if !self.record_dropped_delta(dropped) {
                return false;
            }
        }

        self.bytes += size;
        self.notifications.push_back(message);
        true
    }

    fn record_dropped_delta(&mut self, message: ServerMessage) -> bool {
        let Ok(scope) = serde_json::from_str::<TaskScope<'_>>(message.params.get()) else {
            return true;
        };
        if scope.thread_id.len() > 512 {
            return false;
        }
        let task_id = scope.thread_id.to_owned();
        if self.resync_task_ids.contains(&task_id) {
            return true;
        }
        // 重同步只保留作用域；不能让已丢弃的巨大 delta 经由信号继续驻留。
        let Ok(params) = serde_json::value::to_raw_value(&serde_json::json!({"threadId": task_id}))
        else {
            return false;
        };
        let message = ServerMessage {
            id: None,
            method: EVENT_RETENTION_EXCEEDED_METHOD.to_owned(),
            params,
        };
        let size = task_id.len() * 2 + message_bytes(&message);
        if self.pending_resyncs.len() >= RESYNC_COUNT || self.resync_bytes + size > RESYNC_BYTES {
            return false;
        }
        self.resync_bytes += size;
        self.resync_task_ids.insert(task_id.clone());
        self.pending_resyncs.push_back((task_id, message));
        true
    }
}

fn is_recoverable_delta(message: &ServerMessage) -> bool {
    message.id.is_none() && RECOVERABLE_DELTA_METHODS.contains(&message.method.as_str())
}

fn is_ignored_reasoning_notification(message: &ServerMessage) -> bool {
    message.id.is_none() && IGNORED_REASONING_METHODS.contains(&message.method.as_str())
}

#[cfg(test)]
mod tests {
    use serde_json::value::to_raw_value;

    use super::*;

    #[test]
    fn fact_notifications_should_not_exceed_capacity() {
        let mut buffer = NotificationBuffer::new(4);
        for _ in 0..20 {
            buffer.push(ServerMessage {
                id: None,
                method: "turn/completed".to_owned(),
                params: to_raw_value(&serde_json::json!({"threadId":"thread-a"})).unwrap(),
            });
        }
        assert!(buffer.notifications.len() <= 4);
    }

    #[test]
    fn resync_signal_should_not_retain_dropped_payload() {
        let mut buffer = NotificationBuffer::new(0);
        buffer.push(ServerMessage {
            id: None,
            method: "item/commandExecution/outputDelta".to_owned(),
            params: to_raw_value(
                &serde_json::json!({"threadId":"thread-a", "delta":"x".repeat(65_536)}),
            )
            .unwrap(),
        });
        assert!(buffer.pop_front().unwrap().params.get().len() < 512);
    }

    #[test]
    fn byte_and_resync_scope_budgets_should_be_hard_limits() {
        let mut buffer = NotificationBuffer::new(256);
        for _ in 0..20 {
            buffer.push(ServerMessage {
                id: None,
                method: "item/completed".to_owned(),
                params: to_raw_value(&"x".repeat(1024 * 1024)).unwrap(),
            });
        }
        assert!(buffer.bytes <= NOTIFICATION_BYTES);
        assert!(buffer.notifications.len() < 256);
        let mut buffer = NotificationBuffer::new(0);
        let mut rejected = false;
        for index in 0..1_000 {
            rejected |= !buffer.push(ServerMessage {
                id: None,
                method: "item/commandExecution/outputDelta".to_owned(),
                params: to_raw_value(
                    &serde_json::json!({"threadId":format!("thread-{index}"),"delta":"x"}),
                )
                .unwrap(),
            });
        }
        assert!(rejected);
        assert!(buffer.resync_bytes <= RESYNC_BYTES);
        assert!(buffer.pending_resyncs.len() <= RESYNC_COUNT);
    }

    #[test]
    fn reasoning_notifications_are_discarded_before_buffering() {
        let mut buffer = NotificationBuffer::new(1);

        for method in IGNORED_REASONING_METHODS {
            buffer.push(ServerMessage {
                id: None,
                method: (*method).to_owned(),
                params: to_raw_value(&serde_json::json!({
                    "threadId": "thread-a",
                    "turnId": "turn-a"
                }))
                .unwrap(),
            });
        }

        assert!(buffer.is_empty());

        buffer.push(ServerMessage {
            id: None,
            method: "item/reasoning/summaryTextDelta".to_owned(),
            params: to_raw_value(&serde_json::json!({
                "threadId": "thread-a", "turnId": "turn-a", "itemId": "reason-a", "delta": "摘要"
            }))
            .unwrap(),
        });
        assert_eq!(
            buffer.pop_front().unwrap().method,
            "item/reasoning/summaryTextDelta"
        );
    }
}
