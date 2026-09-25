use std::borrow::Cow;

use serde::Deserialize;

use crate::domain::runtime::{AgentDeltaEvent, AgentDeltaPayload, AgentDeltaType, ProviderKind};

use super::{
    connection::{ConnectionError, ServerMessage},
    conversation::RUNTIME_SESSION_ID,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeltaNotification<'a> {
    thread_id: &'a str,
    turn_id: &'a str,
    item_id: &'a str,
    // JSON 转义内容无法直接借用；Cow 仅在换行等转义出现时分配解码缓冲区。
    #[serde(borrow)]
    delta: Cow<'a, str>,
}

pub(super) fn map_delta_message(
    message: &ServerMessage,
    sequence: u64,
    timestamp: &str,
    received_at_unix_ms: u64,
) -> Result<Option<AgentDeltaEvent>, ConnectionError> {
    let event_type = match message.method.as_str() {
        "item/reasoning/textDelta" => return Ok(None),
        "item/reasoning/summaryTextDelta" => AgentDeltaType::Reasoning,
        "item/agentMessage/delta" => AgentDeltaType::Message,
        "item/commandExecution/outputDelta" => AgentDeltaType::CommandOutput,
        "item/plan/delta" => AgentDeltaType::Plan,
        _ => return Ok(None),
    };
    let params: DeltaNotification<'_> = serde_json::from_str(message.params.get())?;

    Ok(Some(AgentDeltaEvent {
        item_id: params.item_id.to_owned(),
        payload: AgentDeltaPayload {
            delta: params.delta.into_owned(),
        },
        provider: ProviderKind::Codex,
        received_at_unix_ms,
        sequence,
        session_id: RUNTIME_SESSION_ID,
        task_id: params.thread_id.to_owned(),
        timestamp: timestamp.to_owned(),
        turn_id: params.turn_id.to_owned(),
        event_type,
        version: 2,
        source_event_count: 1,
    }))
}

#[cfg(test)]
mod tests {
    use serde_json::{json, value::to_raw_value};

    use super::*;

    #[test]
    fn maps_agent_message_delta_with_escaped_newlines() {
        let message = ServerMessage {
            id: None,
            method: "item/agentMessage/delta".to_owned(),
            params: to_raw_value(&json!({
                "threadId": "thread-a",
                "turnId": "turn-a",
                "itemId": "item-a",
                "delta": "\n\n- 下一项"
            }))
            .unwrap(),
        };

        let event = map_delta_message(&message, 4, "2025-01-01T00:00:00Z", 1_735_689_600_456)
            .unwrap()
            .unwrap();

        assert_eq!(event.payload.delta, "\n\n- 下一项");
        assert_eq!(event.event_type, AgentDeltaType::Message);
    }

    #[test]
    fn forwards_only_reasoning_summary_deltas() {
        for (method, expected) in [
            (
                "item/reasoning/summaryTextDelta",
                Some(AgentDeltaType::Reasoning),
            ),
            ("item/reasoning/textDelta", None),
        ] {
            let message = ServerMessage {
                id: None,
                method: method.to_owned(),
                params: to_raw_value(&json!({
                    "threadId": "thread-a",
                    "turnId": "turn-a",
                    "itemId": "item-a",
                    "delta": "hidden",
                    "summaryIndex": 0,
                    "contentIndex": 0
                }))
                .unwrap(),
            };

            assert_eq!(
                map_delta_message(&message, 1, "2025-01-01T00:00:00Z", 0)
                    .unwrap()
                    .map(|event| event.event_type),
                expected
            );
        }
    }
}
