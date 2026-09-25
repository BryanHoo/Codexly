use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{Map, Value, json};

#[cfg(test)]
#[path = "conversation_user_input_tests.rs"]
mod user_input_tests;

#[path = "conversation_permission_resolution.rs"]
mod permission_resolution;

use super::{
    connection::{ConnectionError, ServerMessage},
    conversation::RUNTIME_SESSION_ID,
    conversation_plugin_install::{map_plugin_install_suggestion, response_for_plugin_suggestion},
    conversation_request_fields::{map_mcp_fields, map_permission_profile},
    sidebar::unix_seconds_to_rfc3339,
};

#[derive(Debug)]
pub struct PendingServerRequest {
    pub rpc_id: u64,
    pub method: String,
    pub request: Value,
    pub native_permissions: Option<Value>,
    deny_decision: &'static str,
}

pub struct MappedServerRequest {
    pub event: Value,
    pub pending: PendingServerRequest,
}

pub fn map_server_request(
    message: ServerMessage,
    sequence: u64,
    timestamp: &str,
) -> Result<Option<MappedServerRequest>, ConnectionError> {
    let Some(rpc_id) = message.id else {
        return Ok(None);
    };
    let params: Value = serde_json::from_str(message.params.get())?;
    let params = params.as_object().ok_or(ConnectionError::InvalidMessage)?;
    let request_id = format!("number:{rpc_id}");
    let task_id = required_string(params, "threadId")?;
    let request = match message.method.as_str() {
        "item/commandExecution/requestApproval" => {
            map_command_request(params, &request_id, task_id)?
        }
        "item/fileChange/requestApproval" => map_file_request(params, &request_id, task_id)?,
        "item/permissions/requestApproval" => map_permission_request(params, &request_id, task_id)?,
        "item/tool/requestUserInput" => {
            map_user_input_request(params, &request_id, task_id, timestamp)?
        }
        "mcpServer/elicitation/request" => {
            map_mcp_request(params, &request_id, task_id, timestamp)?
        }
        _ => return Ok(None),
    };
    let item_id = required_string(
        request.as_object().ok_or(ConnectionError::InvalidMessage)?,
        "itemId",
    )?;
    let turn_id = required_string(
        request.as_object().ok_or(ConnectionError::InvalidMessage)?,
        "turnId",
    )?;
    let event = envelope(
        sequence,
        timestamp,
        task_id,
        json!({
            "itemId": item_id,
            "payload": {"request": request},
            "turnId": turn_id,
            "type": "pending_request.created",
        }),
    );
    Ok(Some(MappedServerRequest {
        event,
        pending: PendingServerRequest {
            rpc_id,
            method: message.method,
            native_permissions: params.get("permissions").cloned(),
            deny_decision: map_deny_decision(params.get("availableDecisions")),
            request,
        },
    }))
}

pub fn map_server_request_now(
    message: ServerMessage,
    sequence: u64,
) -> Result<Option<MappedServerRequest>, ConnectionError> {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| ConnectionError::StateUnavailable)?
        .as_secs();
    let seconds = i64::try_from(seconds).map_err(|_| ConnectionError::StateUnavailable)?;
    map_server_request(message, sequence, &unix_seconds_to_rfc3339(seconds))
}

pub fn response_for_resolution(
    pending: &PendingServerRequest,
    resolution: &Value,
) -> Result<Value, ConnectionError> {
    let resolution = resolution
        .as_object()
        .ok_or(ConnectionError::InvalidMessage)?;
    match pending.method.as_str() {
        "item/commandExecution/requestApproval" | "item/fileChange/requestApproval" => {
            let decision = match required_string(resolution, "decision")? {
                "allow" => "accept",
                "allow_for_session" => "acceptForSession",
                "deny" => pending.deny_decision,
                _ => return Err(ConnectionError::InvalidMessage),
            };
            Ok(json!({"decision": decision}))
        }
        "item/tool/requestUserInput" => {
            let answers = resolution
                .get("answers")
                .and_then(Value::as_object)
                .ok_or(ConnectionError::InvalidMessage)?;
            validate_user_input_answers(&pending.request, answers)?;
            Ok(json!({"answers": answers.iter().map(|(id, answers)| {
                (id.clone(), json!({"answers": answers}))
            }).collect::<Map<_, _>>()}))
        }
        "item/permissions/requestApproval" => permission_resolution::response(pending, resolution),
        "mcpServer/elicitation/request" if pending.request["mode"] == "unsupported" => {
            // 未实现设备验证与扩展表单，后端只允许取消或拒绝，不能伪造验证证明。
            let action = required_string(resolution, "action")?;
            if !matches!(action, "cancel" | "decline") {
                return Err(ConnectionError::InvalidMessage);
            }
            Ok(json!({"_meta": null, "action": action, "content": null}))
        }
        "mcpServer/elicitation/request" => Ok(json!({
            "_meta": null,
            "action": required_string(resolution, "action")?,
            "content": resolution.get("content").cloned().unwrap_or(Value::Null),
        }))
        .and_then(|fallback| {
            response_for_plugin_suggestion(&pending.request, resolution)
                .map(|suggestion| suggestion.unwrap_or(fallback))
        }),
        _ => Err(ConnectionError::InvalidMessage),
    }
}

pub fn resolved_request_id(message: &ServerMessage) -> Result<Option<String>, ConnectionError> {
    if message.id.is_some() || message.method != "serverRequest/resolved" {
        return Ok(None);
    }
    let params: Value = serde_json::from_str(message.params.get())?;
    let request_id = params
        .get("requestId")
        .ok_or(ConnectionError::InvalidMessage)?;
    match request_id {
        Value::Number(value) => Ok(Some(format!("number:{value}"))),
        Value::String(value) => Ok(Some(format!("string:{value}"))),
        _ => Err(ConnectionError::InvalidMessage),
    }
}

fn map_command_request(
    params: &Map<String, Value>,
    request_id: &str,
    task_id: &str,
) -> Result<Value, ConnectionError> {
    let kind = required_string(params, "kind")?;
    let mut request = approval_identity(params, request_id, task_id)?;
    let request = request
        .as_object_mut()
        .ok_or(ConnectionError::InvalidMessage)?;
    let fields = match kind {
        "command" => json!({
            "additionalPermissions": params.get("additionalPermissions").filter(|value| !value.is_null()).map(|value| map_permission_profile(value.as_object().ok_or(ConnectionError::InvalidMessage)?)).transpose()?,
            "availableDecisions": map_approval_decisions(params.get("availableDecisions"))?,
            "command": optional_value(params, "command"),
            "cwd": optional_value(params, "cwd"),
            "networkAccess": params.get("networkApprovalContext").cloned().unwrap_or(Value::Null),
            "reason": optional_value(params, "reason"),
            "type": "command_approval",
        }),
        "writeStdin" => {
            let command = required_string(params, "command")?;
            let parts = shlex::split(command).ok_or(ConnectionError::InvalidMessage)?;
            // Codex 0.152 将终端输入编码为固定四段命令，严格解析可避免误判普通命令。
            if parts.len() != 4 || parts[0] != "write_stdin" || parts[1] != "--session-id" {
                return Err(ConnectionError::InvalidMessage);
            }
            json!({
                "approvalId": required_string(params, "approvalId")?,
                "availableDecisions": map_approval_decisions(params.get("availableDecisions"))?,
                "cwd": required_string(params, "cwd")?,
                "processId": parts[2],
                "reason": optional_value(params, "reason"),
                "stdin": parts[3],
                "type": "terminal_input_approval",
            })
        }
        _ => return Err(ConnectionError::InvalidMessage),
    };
    request.extend(fields.as_object().unwrap().clone());
    Ok(Value::Object(request.clone()))
}

fn map_file_request(
    params: &Map<String, Value>,
    request_id: &str,
    task_id: &str,
) -> Result<Value, ConnectionError> {
    let mut request = approval_identity(params, request_id, task_id)?;
    request.as_object_mut().unwrap().extend(
        json!({
            "availableDecisions": map_approval_decisions(params.get("availableDecisions"))?,
            "grantRoot": optional_value(params, "grantRoot"),
            "reason": optional_value(params, "reason"),
            "type": "file_change_approval",
        })
        .as_object()
        .unwrap()
        .clone(),
    );
    Ok(request)
}

fn map_permission_request(
    params: &Map<String, Value>,
    request_id: &str,
    task_id: &str,
) -> Result<Value, ConnectionError> {
    let native = params
        .get("permissions")
        .and_then(Value::as_object)
        .ok_or(ConnectionError::InvalidMessage)?;
    Ok(json!({
        "createdAt": started_at(params)?, "cwd": required_string(params, "cwd")?,
        "environmentId": optional_value(params, "environmentId"), "expiresAt": null,
        "itemId": required_string(params, "itemId")?, "permissions": map_permission_profile(native)?,
        "projectId": "", "reason": optional_value(params, "reason"), "requestId": request_id,
        "status": "pending", "taskId": task_id, "turnId": required_string(params, "turnId")?,
        "type": "permissions_approval",
    }))
}

fn validate_user_input_answers(
    request: &Value,
    answers: &Map<String, Value>,
) -> Result<(), ConnectionError> {
    let questions = request["questions"]
        .as_array()
        .ok_or(ConnectionError::InvalidMessage)?;
    if questions.is_empty() || questions.len() > 3 || questions.len() != answers.len() {
        return Err(ConnectionError::InvalidMessage);
    }
    // 原生题目决定回答集合；先借用校验，避免为非法输入复制答案正文。
    for (index, question) in questions.iter().enumerate() {
        let id = question["id"]
            .as_str()
            .ok_or(ConnectionError::InvalidMessage)?;
        if questions[..index]
            .iter()
            .any(|previous| previous["id"] == id)
        {
            return Err(ConnectionError::InvalidMessage);
        }
        let values = answers
            .get(id)
            .and_then(Value::as_array)
            .ok_or(ConnectionError::InvalidMessage)?;
        if values.len() != 1
            || !values[0]
                .as_str()
                .is_some_and(|text| !text.trim().is_empty())
        {
            return Err(ConnectionError::InvalidMessage);
        }
    }
    // 只检查非空，不修剪有效正文或强制匹配选项，以保留自由输入和秘密值。
    Ok(())
}

fn map_user_input_request(
    params: &Map<String, Value>,
    request_id: &str,
    task_id: &str,
    timestamp: &str,
) -> Result<Value, ConnectionError> {
    let questions = params
        .get("questions")
        .and_then(Value::as_array)
        .ok_or(ConnectionError::InvalidMessage)?
        .iter()
        .map(map_question)
        .collect::<Result<Vec<_>, _>>()?;
    if questions.is_empty() || questions.len() > 3 {
        return Err(ConnectionError::InvalidMessage);
    }
    Ok(json!({
        "createdAt": timestamp, "expiresAt": null, "itemId": required_string(params, "itemId")?,
        "projectId": "", "questions": questions, "requestId": request_id, "status": "pending",
        "taskId": task_id, "turnId": required_string(params, "turnId")?, "type": "user_input",
    }))
}

fn map_mcp_request(
    params: &Map<String, Value>,
    request_id: &str,
    task_id: &str,
    timestamp: &str,
) -> Result<Value, ConnectionError> {
    let mode = required_string(params, "mode")?;
    let turn_id = params
        .get("turnId")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .unwrap_or_else(|| format!("mcp-elicitation:{request_id}"));
    if let Some(request) =
        map_plugin_install_suggestion(params, request_id, task_id, &turn_id, timestamp)?
    {
        return Ok(request);
    }
    // 154 的验证请求使用 description 而非 message；challenge 留在服务端，不进入 IPC。
    let message = if mode == "openai/userVerification" {
        required_string(params, "description")?
    } else {
        required_string(params, "message")?
    };
    let mut request = json!({
        "createdAt": timestamp, "expiresAt": null, "itemId": format!("mcp-elicitation:{request_id}"),
        "message": message, "projectId": "", "requestId": request_id,
        "serverName": required_string(params, "serverName")?, "status": "pending", "taskId": task_id,
        "turnId": turn_id, "type": "mcp_elicitation",
    });
    let fields = request.as_object_mut().unwrap();
    match mode {
        "url" => {
            let url = required_string(params, "url")?;
            if !url.starts_with("https://") && !url.starts_with("http://") {
                return Err(ConnectionError::InvalidMessage);
            }
            fields.extend(json!({"mode": "url", "url": url}).as_object().unwrap().clone());
        }
        "form" => fields.extend(json!({"fields": map_mcp_fields(params.get("requestedSchema").ok_or(ConnectionError::InvalidMessage)?)?, "mode": "form"}).as_object().unwrap().clone()),
        "openai/form" | "openaiForm" | "openai/userVerification" => { fields.insert("mode".to_owned(), json!("unsupported")); }
        _ => return Err(ConnectionError::InvalidMessage),
    }
    Ok(request)
}

fn map_question(value: &Value) -> Result<Value, ConnectionError> {
    let question = value.as_object().ok_or(ConnectionError::InvalidMessage)?;
    let native_options = question.get("options").filter(|value| !value.is_null());
    let options = native_options
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let is_other = question
        .get("isOther")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    if native_options.is_some() && options.is_empty() && !is_other {
        return Err(ConnectionError::InvalidMessage);
    }
    let confirmation = options.len() == 2 && !is_other && is_confirmation(&options);
    Ok(json!({
        "header": required_string(question, "header")?, "id": required_string(question, "id")?,
        "isOther": is_other, "isSecret": question.get("isSecret").and_then(Value::as_bool).unwrap_or(false),
        "options": options, "prompt": required_string(question, "question")?,
        "type": if native_options.is_none() {"short_text"} else if confirmation {"confirmation"} else {"choice"},
    }))
}

fn is_confirmation(options: &[Value]) -> bool {
    let labels = options
        .iter()
        .filter_map(|option| option.get("label").and_then(Value::as_str))
        .map(str::to_lowercase)
        .collect::<Vec<_>>();
    [
        ["yes", "no"],
        ["allow", "deny"],
        ["accept", "decline"],
        ["是", "否"],
    ]
    .iter()
    .any(|pair| {
        pair.iter()
            .all(|label| labels.iter().any(|value| value == label))
    })
}

fn approval_identity(
    params: &Map<String, Value>,
    request_id: &str,
    task_id: &str,
) -> Result<Value, ConnectionError> {
    Ok(json!({
        "createdAt": started_at(params)?, "expiresAt": null, "itemId": required_string(params, "itemId")?,
        "projectId": "", "requestId": request_id, "status": "pending", "taskId": task_id,
        "turnId": required_string(params, "turnId")?,
    }))
}

fn started_at(params: &Map<String, Value>) -> Result<String, ConnectionError> {
    let milliseconds = params
        .get("startedAtMs")
        .and_then(Value::as_i64)
        .ok_or(ConnectionError::InvalidMessage)?;
    Ok(unix_seconds_to_rfc3339(milliseconds.div_euclid(1000)))
}

fn map_approval_decisions(value: Option<&Value>) -> Result<Vec<&'static str>, ConnectionError> {
    let defaults = vec![json!("accept"), json!("acceptForSession"), json!("decline")];
    let values = value.and_then(Value::as_array).unwrap_or(&defaults);
    let mut decisions = Vec::new();
    if values.iter().any(|value| value == "accept") {
        decisions.push("allow");
    }
    if values.iter().any(|value| value == "acceptForSession") {
        decisions.push("allow_for_session");
    }
    if values
        .iter()
        .any(|value| value == "decline" || value == "cancel")
    {
        decisions.push("deny");
    }
    if decisions.is_empty() {
        return Err(ConnectionError::InvalidMessage);
    }
    Ok(decisions)
}

fn map_deny_decision(value: Option<&Value>) -> &'static str {
    if value
        .and_then(Value::as_array)
        .is_some_and(|values| values.iter().any(|value| value == "decline"))
    {
        "decline"
    } else {
        "cancel"
    }
}

fn optional_value(params: &Map<String, Value>, key: &str) -> Value {
    params.get(key).cloned().unwrap_or(Value::Null)
}

fn required_string<'a>(
    params: &'a Map<String, Value>,
    key: &str,
) -> Result<&'a str, ConnectionError> {
    params
        .get(key)
        .and_then(Value::as_str)
        .ok_or(ConnectionError::InvalidMessage)
}

fn envelope(sequence: u64, timestamp: &str, task_id: &str, fields: Value) -> Value {
    let mut event = json!({"provider": "codex", "sequence": sequence, "sessionId": RUNTIME_SESSION_ID, "taskId": task_id, "timestamp": timestamp, "version": 2});
    event
        .as_object_mut()
        .unwrap()
        .extend(fields.as_object().unwrap().clone());
    event
}
