use serde_json::{Map, Value, json};

use super::{
    connection::ConnectionError,
    conversation_events::{envelope, required_string},
};

pub(super) fn map_runtime_notification(
    method: &str,
    params: &Map<String, Value>,
    sequence: u64,
    timestamp: &str,
) -> Result<Option<Value>, ConnectionError> {
    let event = match method {
        "thread/status/changed" => task_status_event(params, sequence, timestamp)?,
        "thread/name/updated" => task_metadata_event(params, sequence, timestamp)?,
        "thread/archived" | "thread/deleted" => envelope(
            sequence,
            timestamp,
            required_string(params, "threadId")?,
            json!({
                "payload": {"reason": if method == "thread/archived" {"archived"} else {"deleted"}},
                "type": "task.removed",
            }),
        ),
        "model/rerouted" => model_rerouted_event(params, sequence, timestamp)?,
        "model/safetyBuffering/updated" => safety_buffering_event(params, sequence, timestamp)?,
        "model/verification" => envelope(
            sequence,
            timestamp,
            required_string(params, "threadId")?,
            json!({
                "payload": {
                    "code": "model_verification",
                    "level": "warning",
                    "message": "Model access verification is required.",
                },
                "type": "task.notice",
            }),
        ),
        "hook/started" | "hook/completed" => hook_event(method, params, sequence, timestamp)?,
        "item/autoApprovalReview/started" | "item/autoApprovalReview/completed" => {
            approval_review_event(method, params, sequence, timestamp)?
        }
        "mcpServer/startupStatus/updated" => mcp_server_status_event(params, sequence, timestamp)?,
        _ => return Ok(None),
    };
    Ok(Some(event))
}

fn task_metadata_event(
    params: &Map<String, Value>,
    sequence: u64,
    timestamp: &str,
) -> Result<Value, ConnectionError> {
    let mut payload = Map::new();
    if let Some(title) = params
        .get("threadName")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|title| !title.is_empty())
    {
        payload.insert("title".to_owned(), Value::String(title.to_owned()));
    }
    Ok(envelope(
        sequence,
        timestamp,
        required_string(params, "threadId")?,
        json!({"payload": payload, "type": "task.metadata_changed"}),
    ))
}

fn mcp_server_status_event(
    params: &Map<String, Value>,
    sequence: u64,
    timestamp: &str,
) -> Result<Value, ConnectionError> {
    let status = match required_string(params, "status")? {
        "starting" => "starting",
        "ready" => "ready",
        "failed" => "failed",
        "cancelled" => "cancelled",
        _ => return Err(ConnectionError::InvalidMessage),
    };
    let failure_reason = match params.get("failureReason") {
        None | Some(Value::Null) => Value::Null,
        Some(Value::String(value)) if value == "reauthenticationRequired" => {
            Value::String(value.clone())
        }
        _ => return Err(ConnectionError::InvalidMessage),
    };
    let error = match params.get("error") {
        None | Some(Value::Null) => Value::Null,
        Some(Value::String(value)) => Value::String(value.chars().take(8_192).collect()),
        _ => return Err(ConnectionError::InvalidMessage),
    };
    Ok(envelope(
        sequence,
        timestamp,
        required_string(params, "threadId")?,
        json!({
            "payload": {
                "error": error,
                "failureReason": failure_reason,
                "name": required_string(params, "name")?,
                "status": status,
            },
            "type": "mcp_server.status_updated",
        }),
    ))
}

fn hook_event(
    method: &str,
    params: &Map<String, Value>,
    sequence: u64,
    timestamp: &str,
) -> Result<Value, ConnectionError> {
    let run = params
        .get("run")
        .and_then(Value::as_object)
        .ok_or(ConnectionError::InvalidMessage)?;
    let event_name = required_string(run, "eventName")?;
    let status = if method == "hook/started" {
        "running"
    } else {
        match required_string(run, "status")? {
            "running" => "running",
            "completed" => "completed",
            "failed" | "blocked" => "failed",
            "stopped" => "interrupted",
            _ => return Err(ConnectionError::InvalidMessage),
        }
    };
    let mut item = json!({
        "eventName": event_name,
        "id": format!("hook-{}", required_string(run, "id")?),
        "kind": "hook",
        "status": status,
        "type": "runtime_status",
    });
    if let Some(detail) = run.get("statusMessage").and_then(Value::as_str) {
        item["detail"] = Value::String(detail.chars().take(8_192).collect());
    }
    if let Some(duration) = run.get("durationMs").and_then(Value::as_u64) {
        item["durationMs"] = Value::from(duration);
    }
    let task_id = required_string(params, "threadId")?;
    let Some(turn_id) = params.get("turnId").and_then(Value::as_str) else {
        return Ok(envelope(
            sequence,
            timestamp,
            task_id,
            json!({
                "payload": {
                    "code": "hook_status",
                    "level": if status == "failed" {"warning"} else {"info"},
                    "message": item.get("detail").and_then(Value::as_str).unwrap_or(event_name),
                },
                "type": "task.notice",
            }),
        ));
    };
    Ok(envelope(
        sequence,
        timestamp,
        task_id,
        json!({
            "itemId": item["id"],
            "payload": {"item": item},
            "turnId": turn_id,
            "type": if method == "hook/started" {"item.started"} else {"item.completed"},
        }),
    ))
}

fn approval_review_event(
    method: &str,
    params: &Map<String, Value>,
    sequence: u64,
    timestamp: &str,
) -> Result<Value, ConnectionError> {
    let review = params
        .get("review")
        .and_then(Value::as_object)
        .ok_or(ConnectionError::InvalidMessage)?;
    let action = params
        .get("action")
        .and_then(Value::as_object)
        .ok_or(ConnectionError::InvalidMessage)?;
    let status = match required_string(review, "status")? {
        "inProgress" => "in_progress",
        "approved" => "approved",
        "denied" => "denied",
        "timedOut" => "timed_out",
        "aborted" => "aborted",
        _ => return Err(ConnectionError::InvalidMessage),
    };
    let item_id = format!(
        "auto-approval-review-{}",
        required_string(params, "reviewId")?
    );
    let mut item = json!({
        "action": map_review_action(action)?,
        "id": item_id,
        "status": status,
        "type": "approval_review",
    });
    for key in ["rationale", "riskLevel", "userAuthorization"] {
        if let Some(value) = review.get(key).and_then(Value::as_str) {
            item[key] = Value::String(value.to_owned());
        }
    }
    if let Some(value) = params.get("targetItemId").and_then(Value::as_str) {
        item["targetItemId"] = Value::String(value.to_owned());
    }
    Ok(envelope(
        sequence,
        timestamp,
        required_string(params, "threadId")?,
        json!({
            "itemId": item_id,
            "payload": {"item": item},
            "turnId": required_string(params, "turnId")?,
            "type": if method.ends_with("/started") {"item.started"} else {"item.completed"},
        }),
    ))
}

fn map_review_action(action: &Map<String, Value>) -> Result<Value, ConnectionError> {
    let native_type = required_string(action, "type")?;
    let (kind, detail) = match native_type {
        "command" => ("command", required_string(action, "command")?.to_owned()),
        "execve" => {
            let argv = action
                .get("argv")
                .and_then(Value::as_array)
                .ok_or(ConnectionError::InvalidMessage)?
                .iter()
                .map(|value| value.as_str().ok_or(ConnectionError::InvalidMessage))
                .collect::<Result<Vec<_>, _>>()?;
            (
                "command",
                std::iter::once(required_string(action, "program")?)
                    .chain(argv)
                    .collect::<Vec<_>>()
                    .join(" "),
            )
        }
        "writeStdin" => {
            // Guardian 对终端输入使用独立 action，保留会话与工作目录供界面核验。
            return Ok(json!({
                "approvalId": required_string(action, "approvalId")?,
                "cwd": required_string(action, "cwd")?,
                "detail": required_string(action, "stdin")?,
                "processId": required_string(action, "processId")?,
                "type": "terminal_input",
            }));
        }
        "applyPatch" => {
            let files = action
                .get("files")
                .and_then(Value::as_array)
                .ok_or(ConnectionError::InvalidMessage)?
                .iter()
                .map(|value| value.as_str().ok_or(ConnectionError::InvalidMessage))
                .collect::<Result<Vec<_>, _>>()?;
            ("file_change", files.join("\n"))
        }
        "networkAccess" => (
            "network_access",
            required_string(action, "target")?.to_owned(),
        ),
        "mcpToolCall" => (
            "mcp_tool_call",
            action
                .get("toolTitle")
                .and_then(Value::as_str)
                .map(str::to_owned)
                .unwrap_or_else(|| {
                    format!(
                        "{}/{}",
                        action
                            .get("server")
                            .and_then(Value::as_str)
                            .unwrap_or("mcp"),
                        action
                            .get("toolName")
                            .and_then(Value::as_str)
                            .unwrap_or("tool")
                    )
                }),
        ),
        "requestPermissions" => (
            "permissions",
            action
                .get("reason")
                .and_then(Value::as_str)
                .map(str::to_owned)
                .unwrap_or_else(|| {
                    action
                        .get("permissions")
                        .unwrap_or(&Value::Null)
                        .to_string()
                }),
        ),
        _ => return Err(ConnectionError::InvalidMessage),
    };
    Ok(json!({"detail": detail, "type": kind}))
}

fn task_status_event(
    params: &Map<String, Value>,
    sequence: u64,
    timestamp: &str,
) -> Result<Value, ConnectionError> {
    let status = params
        .get("status")
        .and_then(Value::as_object)
        .and_then(|status| status.get("type"))
        .and_then(Value::as_str)
        .ok_or(ConnectionError::InvalidMessage)?;
    let status = match status {
        "active" => "running",
        "systemError" => "failed",
        "idle" | "notLoaded" => "idle",
        _ => return Err(ConnectionError::InvalidMessage),
    };
    Ok(envelope(
        sequence,
        timestamp,
        required_string(params, "threadId")?,
        json!({"payload": {"status": status}, "type": "task.status_updated"}),
    ))
}

fn model_rerouted_event(
    params: &Map<String, Value>,
    sequence: u64,
    timestamp: &str,
) -> Result<Value, ConnectionError> {
    let turn_id = required_string(params, "turnId")?;
    let item_id = format!("runtime-reroute-{turn_id}");
    Ok(envelope(
        sequence,
        timestamp,
        required_string(params, "threadId")?,
        json!({
            "itemId": item_id,
            "payload": {"item": {
                "fromModel": required_string(params, "fromModel")?,
                "id": item_id,
                "kind": "model_rerouted",
                "status": "completed",
                "toModel": required_string(params, "toModel")?,
                "type": "runtime_status",
            }},
            "turnId": turn_id,
            "type": "item.completed",
        }),
    ))
}

fn safety_buffering_event(
    params: &Map<String, Value>,
    sequence: u64,
    timestamp: &str,
) -> Result<Value, ConnectionError> {
    let turn_id = required_string(params, "turnId")?;
    let item_id = format!("runtime-safety-{turn_id}");
    let visible = params
        .get("showBufferingUi")
        .and_then(Value::as_bool)
        .ok_or(ConnectionError::InvalidMessage)?;
    let mut item = json!({
        "id": item_id,
        "kind": "safety_buffering",
        "model": required_string(params, "model")?,
        "status": if visible {"running"} else {"completed"},
        "type": "runtime_status",
    });
    if let Some(faster_model) = params.get("fasterModel").and_then(Value::as_str) {
        item["fasterModel"] = Value::String(faster_model.to_owned());
    }
    Ok(envelope(
        sequence,
        timestamp,
        required_string(params, "threadId")?,
        json!({
            "itemId": item_id,
            "payload": {"item": item},
            "turnId": turn_id,
            "type": if visible {"item.started"} else {"item.completed"},
        }),
    ))
}
