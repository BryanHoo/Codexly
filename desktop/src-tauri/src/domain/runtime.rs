use serde::Serialize;
use serde_json::Value;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ProviderKind {
    Codex,
    Claude,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RuntimeStatus {
    #[default]
    Stopped,
    Starting,
    Ready,
    Failed,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CodexRuntimeAvailabilityStatus {
    Compatible,
    Missing,
    Incompatible,
    Failed,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexRuntimeAvailability {
    pub status: CodexRuntimeAvailabilityStatus,
    pub required_version: &'static str,
    pub detected_version: Option<String>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CodexRuntimeInstallPhase {
    Preparing,
    Downloading,
    Installing,
    Ready,
    Failed,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexRuntimeInstallProgress {
    pub current_version: Option<String>,
    pub downloaded_bytes: u64,
    pub phase: CodexRuntimeInstallPhase,
    pub sequence: u64,
    pub target_version: &'static str,
    pub total_bytes: Option<u64>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSnapshot {
    pub schema_version: u16,
    pub status: RuntimeStatus,
    pub provider: Option<ProviderKind>,
    pub last_seq: u64,
}

impl Default for RuntimeSnapshot {
    fn default() -> Self {
        Self {
            schema_version: 1,
            status: RuntimeStatus::Stopped,
            provider: None,
            last_seq: 0,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
pub enum AgentDeltaType {
    #[serde(rename = "command.output_delta")]
    CommandOutput,
    #[serde(rename = "message.delta")]
    Message,
    #[serde(rename = "plan.delta")]
    Plan,
    #[serde(rename = "reasoning.delta")]
    Reasoning,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentDeltaPayload {
    pub delta: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentDeltaEvent {
    pub item_id: String,
    pub payload: AgentDeltaPayload,
    pub provider: ProviderKind,
    pub received_at_unix_ms: u64,
    pub sequence: u64,
    pub session_id: &'static str,
    pub task_id: String,
    pub timestamp: String,
    pub turn_id: String,
    #[serde(rename = "type")]
    pub event_type: AgentDeltaType,
    pub version: u16,
    #[serde(skip)]
    pub source_event_count: u64,
}

impl AgentDeltaEvent {
    pub fn same_stream(&self, other: &Self) -> bool {
        self.task_id == other.task_id
            && self.turn_id == other.turn_id
            && self.item_id == other.item_id
            && self.event_type == other.event_type
    }

    pub fn append(&mut self, other: Self) {
        self.payload.delta.push_str(&other.payload.delta);
        self.source_event_count += other.source_event_count;
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(untagged)]
pub enum AgentEvent {
    Delta(AgentDeltaEvent),
    Json(Value),
}

impl AgentEvent {
    pub fn source_event_count(&self) -> u64 {
        match self {
            Self::Delta(event) => event.source_event_count,
            Self::Json(_) => 1,
        }
    }
    pub fn task_id(&self) -> Option<&str> {
        match self {
            Self::Delta(event) => Some(&event.task_id),
            Self::Json(event) => event.get("taskId").and_then(Value::as_str),
        }
    }

    pub fn event_type(&self) -> Option<&str> {
        match self {
            Self::Delta(event) => Some(match event.event_type {
                AgentDeltaType::CommandOutput => "command.output_delta",
                AgentDeltaType::Message => "message.delta",
                AgentDeltaType::Plan => "plan.delta",
                AgentDeltaType::Reasoning => "reasoning.delta",
            }),
            Self::Json(event) => event.get("type").and_then(Value::as_str),
        }
    }

    pub fn set_sequence(&mut self, sequence: u64) {
        match self {
            Self::Delta(event) => event.sequence = sequence,
            Self::Json(event) => event["sequence"] = Value::from(sequence),
        }
    }

    pub fn as_json(&self) -> Option<&Value> {
        match self {
            Self::Delta(_) => None,
            Self::Json(event) => Some(event),
        }
    }

    pub fn as_json_mut(&mut self) -> Option<&mut Value> {
        match self {
            Self::Delta(_) => None,
            Self::Json(event) => Some(event),
        }
    }
}

impl From<Value> for AgentEvent {
    fn from(value: Value) -> Self {
        Self::Json(value)
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase", tag = "type", content = "data")]
pub enum AppEvent {
    RuntimeStatus {
        seq: u64,
        status: RuntimeStatus,
        provider: Option<ProviderKind>,
    },
    AgentEvent {
        event: AgentEvent,
    },
    ResyncRequired {
        #[serde(rename = "latestSequence")]
        latest_sequence: u64,
        #[serde(rename = "projectId")]
        project_id: String,
        reason: &'static str,
        #[serde(rename = "sessionId")]
        session_id: &'static str,
        #[serde(rename = "type")]
        message_type: &'static str,
        version: u16,
    },
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{
        AppEvent, CodexRuntimeAvailability, CodexRuntimeAvailabilityStatus,
        CodexRuntimeInstallPhase, CodexRuntimeInstallProgress, ProviderKind, RuntimeStatus,
    };

    #[test]
    fn runtime_event_should_match_frontend_contract() {
        let event = AppEvent::RuntimeStatus {
            seq: 7,
            status: RuntimeStatus::Ready,
            provider: Some(ProviderKind::Codex),
        };

        let value = serde_json::to_value(event).expect("event serialization should succeed");

        assert_eq!(
            value,
            json!({
                "type": "runtimeStatus",
                "data": {
                    "seq": 7,
                    "status": "ready",
                    "provider": "codex"
                }
            })
        );
    }

    #[test]
    fn agent_event_should_match_frontend_contract() {
        let event = AppEvent::AgentEvent {
            event: json!({"sequence": 8, "type": "message.delta"}).into(),
        };

        assert_eq!(
            serde_json::to_value(event).unwrap(),
            json!({
                "type": "agentEvent",
                "data": {"event": {"sequence": 8, "type": "message.delta"}}
            })
        );
    }

    #[test]
    fn codex_runtime_availability_should_expose_recovery_details() {
        let availability = CodexRuntimeAvailability {
            detected_version: Some("0.150.0".to_owned()),
            required_version: "0.156.0",
            status: CodexRuntimeAvailabilityStatus::Incompatible,
        };

        assert_eq!(
            serde_json::to_value(availability).unwrap(),
            json!({
                "detectedVersion": "0.150.0",
                "requiredVersion": "0.156.0",
                "status": "incompatible"
            })
        );
    }

    #[test]
    fn codex_runtime_install_progress_should_match_frontend_contract() {
        let progress = CodexRuntimeInstallProgress {
            current_version: Some("0.150.0".to_owned()),
            downloaded_bytes: 42,
            phase: CodexRuntimeInstallPhase::Downloading,
            sequence: 3,
            target_version: "0.156.0",
            total_bytes: Some(100),
        };

        assert_eq!(
            serde_json::to_value(progress).unwrap(),
            json!({
                "currentVersion": "0.150.0",
                "downloadedBytes": 42,
                "phase": "downloading",
                "sequence": 3,
                "targetVersion": "0.156.0",
                "totalBytes": 100
            })
        );
    }
}
