use std::{collections::VecDeque, sync::Mutex};

use serde::Serialize;
use tauri::ipc::{Channel, InvokeResponseBody};

use crate::domain::runtime::AppEvent;

const IN_FLIGHT_BYTES: usize = 1_048_576;
const CONTROL_BYTES: usize = 131_072;
const QUEUED_BYTES: usize = 4 * 1_048_576;
const QUEUED_COUNT: usize = 256;
const IN_FLIGHT_COUNT: usize = 64;

#[derive(Clone, Copy, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamMetrics {
    pub in_flight_bytes: usize,
    pub queued_bytes: usize,
    pub in_flight_high_watermark: usize,
    pub queued_high_watermark: usize,
    pub dropped_events: u64,
}

struct QueuedEvent {
    json: String,
    control: bool,
}

impl QueuedEvent {
    fn bytes(&self) -> usize {
        // 为两个 u64 传输标识预留固定空间，计入发送前的字节预算。
        self.json.len() + 80
    }
}

struct InFlight {
    id: u64,
    bytes: usize,
    resync: bool,
}

struct StreamState {
    channel: Option<Channel>,
    next_id: u64,
    queue: VecDeque<QueuedEvent>,
    in_flight: VecDeque<InFlight>,
    needs_resync: bool,
    resync_in_flight: bool,
    metrics: StreamMetrics,
}

pub(super) struct RuntimeEventStream {
    pub(super) generation: u64,
    inner: Mutex<StreamState>,
}

impl RuntimeEventStream {
    pub(super) fn new(channel: Channel, generation: u64) -> Self {
        Self {
            generation,
            inner: Mutex::new(StreamState {
                channel: Some(channel),
                next_id: 0,
                queue: VecDeque::new(),
                in_flight: VecDeque::new(),
                needs_resync: false,
                resync_in_flight: false,
                metrics: StreamMetrics::default(),
            }),
        }
    }

    #[cfg(test)]
    pub(super) fn snapshot(&self) -> StreamMetrics {
        self.inner
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .metrics
    }

    pub(super) fn queue_depth(&self) -> usize {
        self.inner
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .queue
            .len()
    }

    pub(super) fn close(&self) {
        let mut state = self
            .inner
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        state.channel = None;
        state.queue.clear();
        state.metrics.queued_bytes = 0;
    }

    pub(super) fn publish(&self, event: AppEvent) {
        let control = match &event {
            AppEvent::AgentEvent { event } => event
                .event_type()
                .is_some_and(|kind| kind.starts_with("pending_request.")),
            _ => true,
        };
        // 序列化在 RuntimeSession 锁外完成，队列只持有一次编码后的 JSON。
        let Ok(json) = serde_json::to_string(&event) else {
            return;
        };
        let event = QueuedEvent { json, control };
        let mut state = self
            .inner
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if state.channel.is_none() {
            return;
        }
        let limit = if control {
            IN_FLIGHT_BYTES
        } else {
            IN_FLIGHT_BYTES - CONTROL_BYTES
        };
        if event.bytes() > limit {
            state.metrics.dropped_events += 1;
            state.needs_resync = true;
        } else {
            if state.queue.len() >= QUEUED_COUNT
                || state.metrics.queued_bytes + event.bytes() > QUEUED_BYTES
            {
                // 原生事实与审批注册已完成；丢弃传输副本必须显式要求权威快照恢复。
                state.drop_data();
                if state.queue.len() >= QUEUED_COUNT
                    || state.metrics.queued_bytes + event.bytes() > QUEUED_BYTES
                {
                    state.metrics.dropped_events += 1;
                    state.needs_resync = true;
                    state.flush(self.generation);
                    return;
                }
            }
            state.metrics.queued_bytes += event.bytes();
            state.metrics.queued_high_watermark = state
                .metrics
                .queued_high_watermark
                .max(state.metrics.queued_bytes);
            state.queue.push_back(event);
        }
        state.flush(self.generation);
    }

    pub(super) fn acknowledge(&self, generation: u64, ids: &[u64]) {
        if generation != self.generation || ids.len() > IN_FLIGHT_COUNT {
            return;
        }
        let mut state = self
            .inner
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        for id in ids {
            // 精确确认已发送包；重复、未来和旧连接 ACK 都不能凭空释放额度。
            if let Some(index) = state.in_flight.iter().position(|sent| sent.id == *id)
                && let Some(sent) = state.in_flight.remove(index)
            {
                state.metrics.in_flight_bytes -= sent.bytes;
                if sent.resync {
                    state.resync_in_flight = false;
                }
            }
        }
        state.flush(self.generation);
    }
}

impl StreamState {
    fn drop_data(&mut self) {
        self.queue.retain(|event| {
            if event.control {
                return true;
            }
            self.metrics.queued_bytes -= event.bytes();
            self.metrics.dropped_events += 1;
            false
        });
        self.needs_resync = true;
    }

    fn has_credit(&self, bytes: usize, control: bool) -> bool {
        let (limit, count) = if control {
            (IN_FLIGHT_BYTES, IN_FLIGHT_COUNT)
        } else {
            (IN_FLIGHT_BYTES - CONTROL_BYTES, IN_FLIGHT_COUNT - 8)
        };
        self.metrics.in_flight_bytes + bytes <= limit && self.in_flight.len() < count
    }

    fn flush(&mut self, generation: u64) {
        while self.channel.is_some() {
            if self.needs_resync && !self.resync_in_flight {
                let reset = QueuedEvent {
                    json: r#"{"type":"resyncRequired","data":{"latestSequence":0,"projectId":"*","reason":"event_retention_exceeded","sessionId":"codeagent-runtime","type":"resync.required","version":3}}"#.to_owned(),
                    control: true,
                };
                if !self.has_credit(reset.bytes(), true) {
                    return;
                }
                self.needs_resync = false;
                self.resync_in_flight = true;
                self.send(reset, generation, true);
                continue;
            }
            let Some(front) = self.queue.front() else {
                return;
            };
            if !self.has_credit(front.bytes(), front.control) {
                // 普通输出不能占用控制预留；审批越过输出前先撤销旧增量并发布重同步。
                if !front.control
                    && self
                        .queue
                        .iter()
                        .any(|event| event.control && self.has_credit(event.bytes(), true))
                {
                    self.drop_data();
                    continue;
                }
                return;
            }
            let Some(event) = self.queue.pop_front() else {
                return;
            };
            self.metrics.queued_bytes -= event.bytes();
            self.send(event, generation, false);
        }
    }

    fn send(&mut self, event: QueuedEvent, generation: u64, resync: bool) {
        self.next_id += 1;
        let id = self.next_id;
        let json = format!(
            "{{\"streamId\":{generation},\"deliveryId\":{id},{}",
            &event.json[1..]
        );
        let bytes = json.len();
        // Channel.send 成功只代表已提交，额度直到 WebView 消费 ACK 才释放。
        self.metrics.in_flight_bytes += bytes;
        self.metrics.in_flight_high_watermark = self
            .metrics
            .in_flight_high_watermark
            .max(self.metrics.in_flight_bytes);
        self.in_flight.push_back(InFlight { id, bytes, resync });
        if self
            .channel
            .as_ref()
            .is_none_or(|channel| channel.send(InvokeResponseBody::Json(json)).is_err())
        {
            self.channel = None;
            self.queue.clear();
            self.metrics.queued_bytes = 0;
        }
    }
}
