use std::time::Duration;

use tokio::time::Instant;

use crate::domain::runtime::{AgentDeltaEvent, AgentDeltaType, AgentEvent};

pub(super) const DELTA_MERGE_WINDOW: Duration = Duration::from_millis(12);

#[derive(Clone, Debug, Eq, PartialEq)]
struct DeltaStreamKey {
    task_id: String,
    turn_id: String,
    item_id: String,
    event_type: AgentDeltaType,
}

impl From<&AgentDeltaEvent> for DeltaStreamKey {
    fn from(event: &AgentDeltaEvent) -> Self {
        Self {
            task_id: event.task_id.clone(),
            turn_id: event.turn_id.clone(),
            item_id: event.item_id.clone(),
            event_type: event.event_type,
        }
    }
}

impl DeltaStreamKey {
    fn matches(&self, event: &AgentDeltaEvent) -> bool {
        self.task_id == event.task_id
            && self.turn_id == event.turn_id
            && self.item_id == event.item_id
            && self.event_type == event.event_type
    }
}

pub(super) enum BatchAction {
    Buffered,
    Publish(AgentEvent),
    PublishThen(AgentEvent, AgentEvent),
}

pub(super) struct DeltaBatcher {
    active: Option<(DeltaStreamKey, Instant)>,
    pending: Option<AgentDeltaEvent>,
}

impl DeltaBatcher {
    pub(super) fn new() -> Self {
        Self {
            active: None,
            pending: None,
        }
    }

    pub(super) fn deadline(&self) -> Option<Instant> {
        self.pending
            .as_ref()
            .and_then(|_| self.active.as_ref().map(|(_, deadline)| *deadline))
    }

    pub(super) fn push(&mut self, event: AgentEvent, now: Instant) -> BatchAction {
        let AgentEvent::Delta(delta) = event else {
            self.active = None;
            return match self.pending.take() {
                Some(pending) => BatchAction::PublishThen(AgentEvent::Delta(pending), event),
                None => BatchAction::Publish(event),
            };
        };

        if let Some(mut pending) = self.pending.take() {
            let inside_window = self
                .active
                .as_ref()
                .is_some_and(|(_, deadline)| now < *deadline);
            if inside_window && pending.same_stream(&delta) {
                pending.append(delta);
                self.pending = Some(pending);
                return BatchAction::Buffered;
            }

            self.activate(&delta, now);
            return BatchAction::PublishThen(AgentEvent::Delta(pending), AgentEvent::Delta(delta));
        }

        let merges_active = self
            .active
            .as_ref()
            .is_some_and(|(key, deadline)| *deadline > now && key.matches(&delta));
        if merges_active {
            self.pending = Some(delta);
            return BatchAction::Buffered;
        }

        self.activate(&delta, now);
        BatchAction::Publish(AgentEvent::Delta(delta))
    }

    pub(super) fn flush(&mut self, now: Instant) -> Option<AgentEvent> {
        let pending = self.pending.take()?;
        self.activate(&pending, now);
        Some(AgentEvent::Delta(pending))
    }

    pub(super) fn flush_boundary(&mut self) -> Option<AgentEvent> {
        self.active = None;
        self.pending.take().map(AgentEvent::Delta)
    }

    fn activate(&mut self, event: &AgentDeltaEvent, now: Instant) {
        self.active = Some((DeltaStreamKey::from(event), now + DELTA_MERGE_WINDOW));
    }
}

#[cfg(test)]
mod tests {
    use crate::domain::runtime::{AgentDeltaPayload, ProviderKind};

    use super::*;

    fn delta(value: &str, item_id: &str) -> AgentEvent {
        AgentEvent::Delta(AgentDeltaEvent {
            item_id: item_id.to_owned(),
            payload: AgentDeltaPayload {
                delta: value.to_owned(),
            },
            provider: ProviderKind::Codex,
            received_at_unix_ms: 0,
            sequence: 0,
            session_id: "codeagent-runtime",
            task_id: "task-a".to_owned(),
            timestamp: "2025-01-01T00:00:00Z".to_owned(),
            turn_id: "turn-a".to_owned(),
            event_type: AgentDeltaType::Message,
            version: 2,
            source_event_count: 1,
        })
    }

    fn delta_text(action: BatchAction) -> Option<String> {
        match action {
            BatchAction::Publish(AgentEvent::Delta(event)) => Some(event.payload.delta),
            _ => None,
        }
    }

    #[test]
    fn publishes_first_delta_and_merges_following_window() {
        let start = Instant::now();
        let mut batcher = DeltaBatcher::new();

        assert_eq!(
            delta_text(batcher.push(delta("a", "item-a"), start)),
            Some("a".to_owned())
        );
        assert!(matches!(
            batcher.push(delta("b", "item-a"), start + Duration::from_millis(1)),
            BatchAction::Buffered
        ));
        assert!(matches!(
            batcher.push(delta("c", "item-a"), start + Duration::from_millis(2)),
            BatchAction::Buffered
        ));

        let AgentEvent::Delta(flushed) = batcher
            .flush(start + DELTA_MERGE_WINDOW)
            .expect("buffered delta should flush")
        else {
            panic!("expected typed delta")
        };
        assert_eq!(flushed.payload.delta, "bc");
    }

    #[test]
    fn flushes_pending_delta_before_different_stream() {
        let start = Instant::now();
        let mut batcher = DeltaBatcher::new();
        let _ = batcher.push(delta("a", "item-a"), start);
        let _ = batcher.push(delta("b", "item-a"), start + Duration::from_millis(1));

        let BatchAction::PublishThen(AgentEvent::Delta(first), AgentEvent::Delta(second)) =
            batcher.push(delta("c", "item-b"), start + Duration::from_millis(2))
        else {
            panic!("stream change should flush in order")
        };
        assert_eq!(first.payload.delta, "b");
        assert_eq!(second.payload.delta, "c");
    }
}
