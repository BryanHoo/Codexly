use serde_json::{Map, Value, json};

use super::connection::ConnectionError;

pub(super) fn collaboration_tool_name(value: &str) -> Result<&'static str, ConnectionError> {
    match value {
        "closeAgent" => Ok("agent/close"),
        "followupTask" => Ok("agent/followup_task"),
        "interruptAgent" => Ok("agent/interrupt"),
        "listAgents" => Ok("agent/list"),
        "resumeAgent" => Ok("agent/resume"),
        "sendInput" => Ok("agent/send_input"),
        "sendMessage" => Ok("agent/send_message"),
        "spawnAgent" => Ok("agent/spawn"),
        "wait" => Ok("agent/wait"),
        _ => Err(ConnectionError::InvalidMessage),
    }
}

pub(super) fn map_collaboration_agents(
    item: &Map<String, Value>,
) -> Result<Vec<Value>, ConnectionError> {
    let states = item
        .get("agentsStates")
        .and_then(Value::as_object)
        .ok_or(ConnectionError::InvalidMessage)?;
    states
        .iter()
        .map(|(task_id, value)| {
            let state = value.as_object().ok_or(ConnectionError::InvalidMessage)?;
            let status = match required_string(state, "status")? {
                "pendingInit" => "pending",
                "running" => "running",
                "interrupted" => "interrupted",
                "completed" | "shutdown" => "completed",
                "errored" | "notFound" => "failed",
                _ => return Err(ConnectionError::InvalidMessage),
            };
            // HashMap 的 key 才是官方线程 ID，在 IPC 边界补成前端稳定字段。
            Ok(json!({
                "message": state.get("message").cloned().unwrap_or(Value::Null),
                "status": status,
                "taskId": task_id,
            }))
        })
        .collect()
}

fn required_string<'a>(
    object: &'a Map<String, Value>,
    key: &str,
) -> Result<&'a str, ConnectionError> {
    object
        .get(key)
        .and_then(Value::as_str)
        .ok_or(ConnectionError::InvalidMessage)
}
