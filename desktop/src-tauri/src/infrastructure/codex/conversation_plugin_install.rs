use serde_json::{Map, Value, json};

use super::connection::ConnectionError;

const CODEX_APPS_SERVER: &str = "codex_apps";

pub fn map_plugin_install_suggestion(
    params: &Map<String, Value>,
    request_id: &str,
    task_id: &str,
    turn_id: &str,
    timestamp: &str,
) -> Result<Option<Value>, ConnectionError> {
    let Some(meta) = params.get("_meta").and_then(Value::as_object) else {
        return Ok(None);
    };
    if params.get("serverName").and_then(Value::as_str) != Some(CODEX_APPS_SERVER)
        || meta.get("codex_approval_kind").and_then(Value::as_str) != Some("tool_suggestion")
        || meta.get("suggest_type").and_then(Value::as_str) != Some("install")
    {
        return Ok(None);
    }
    let tool_type = required_string(meta, "tool_type")?;
    if !matches!(tool_type, "plugin" | "connector") {
        return Err(ConnectionError::InvalidMessage);
    }
    let remote_plugin_id = optional_string(meta, "remote_plugin_id");
    if tool_type == "plugin" && remote_plugin_id.is_null() {
        return Err(ConnectionError::InvalidMessage);
    }
    let connector_count = meta
        .get("app_connector_ids")
        .and_then(Value::as_array)
        .map_or(0, Vec::len);
    Ok(Some(json!({
        "connectorCount": connector_count,
        "createdAt": timestamp,
        "expiresAt": null,
        "installUrl": optional_string(meta, "install_url"),
        "itemId": format!("plugin-install:{request_id}"),
        "pluginName": required_string(meta, "tool_name")?,
        "projectId": "",
        "remoteMarketplaceName": "openai-curated-remote",
        "remotePluginId": remote_plugin_id,
        "requestId": request_id,
        "status": "pending",
        "suggestReason": required_string(meta, "suggest_reason")?,
        "suggestionId": optional_string(meta, "suggestion_id"),
        "taskId": task_id,
        "toolId": required_string(meta, "tool_id")?,
        "toolType": tool_type,
        "turnId": turn_id,
        "type": "plugin_install_suggestion",
    })))
}

pub fn response_for_plugin_suggestion(
    request: &Value,
    resolution: &Map<String, Value>,
) -> Result<Option<Value>, ConnectionError> {
    if request.get("type").and_then(Value::as_str) != Some("plugin_install_suggestion") {
        return Ok(None);
    }
    let action = required_string(resolution, "action")?;
    if !matches!(action, "accept" | "decline" | "cancel") {
        return Err(ConnectionError::InvalidMessage);
    }
    let suppress = action == "decline"
        && resolution
            .get("suppressFuture")
            .and_then(Value::as_bool)
            .unwrap_or(false);
    Ok(Some(if suppress {
        json!({"action": action, "_meta": {"persist": "always"}})
    } else {
        json!({"action": action, "_meta": null})
    }))
}

fn optional_string(value: &Map<String, Value>, key: &str) -> Value {
    value
        .get(key)
        .and_then(Value::as_str)
        .map_or(Value::Null, |value| json!(value))
}

fn required_string<'a>(
    value: &'a Map<String, Value>,
    key: &str,
) -> Result<&'a str, ConnectionError> {
    value
        .get(key)
        .and_then(Value::as_str)
        .ok_or(ConnectionError::InvalidMessage)
}
