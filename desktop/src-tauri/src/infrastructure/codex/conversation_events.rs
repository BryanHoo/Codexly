use std::time::{SystemTime, UNIX_EPOCH};

use serde::Deserialize;
use serde_json::{Map, Value, json};

use crate::domain::runtime::AgentEvent;

use super::{
    connection::{ConnectionError, ServerMessage},
    conversation::{NativeTurn, RUNTIME_SESSION_ID, map_item, map_turn},
    conversation_advanced::{NativeGoal, map_native_goal},
    conversation_delta_events::map_delta_message,
    conversation_items::apply_transient_item_lifecycle,
    conversation_runtime_events::map_runtime_notification,
    sidebar::unix_seconds_to_rfc3339,
};

const MAX_REALTIME_DIFF_BYTES: usize = 512 * 1_024;
const MAX_REALTIME_FILE_CHANGES: usize = 100;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TurnNotification {
    thread_id: String,
    turn: NativeTurn,
}

pub fn map_server_message(
    message: ServerMessage,
    sequence: u64,
    timestamp: &str,
) -> Result<Option<Value>, ConnectionError> {
    // 带 id 的服务端请求由审批切片处理，不能误当成普通通知。
    if message.id.is_some() {
        return Ok(None);
    }
    if matches!(
        message.method.as_str(),
        "item/reasoning/summaryPartAdded" | "item/reasoning/textDelta"
    ) {
        return Ok(None);
    }
    let params: Value = serde_json::from_str(message.params.get())?;
    let Some(params_object) = params.as_object() else {
        return Err(ConnectionError::InvalidMessage);
    };
    if let Some(event) =
        map_runtime_notification(&message.method, params_object, sequence, timestamp)?
    {
        return Ok(Some(event));
    }

    let event = match message.method.as_str() {
        "modelProvider/authRecoveryStarted" | "modelProvider/authRecoveryCompleted" => {
            // 当前没有认证恢复进度 UI；校验 152 通知结构后显式消费，避免落入未知通知分支。
            required_string(params_object, "threadId")?;
            required_string(params_object, "turnId")?;
            required_string(params_object, "provider")?;
            required_string(params_object, "message")?;
            return Ok(None);
        }
        "turn/started" | "turn/completed" => {
            let native: TurnNotification = serde_json::from_value(params)?;
            let turn = map_turn(native.turn)?;
            let event_type = if message.method == "turn/started" {
                "turn.started"
            } else {
                "turn.completed"
            };
            envelope(
                sequence,
                timestamp,
                &native.thread_id,
                json!({
                    "payload": {"turn": turn},
                    "turnId": turn.id,
                    "type": event_type,
                }),
            )
        }
        "item/agentMessage/delta" => {
            delta_event(params_object, sequence, timestamp, "message.delta", None)?
        }
        "item/commandExecution/outputDelta" => delta_event(
            params_object,
            sequence,
            timestamp,
            "command.output_delta",
            None,
        )?,
        "item/plan/delta" => delta_event(params_object, sequence, timestamp, "plan.delta", None)?,
        "item/mcpToolCall/progress" => envelope(
            sequence,
            timestamp,
            required_string(params_object, "threadId")?,
            json!({
                "itemId": required_string(params_object, "itemId")?,
                "payload": {"message": required_string(params_object, "message")?},
                "turnId": required_string(params_object, "turnId")?,
                "type": "tool.progress",
            }),
        ),
        "turn/plan/updated" => plan_updated_event(params_object, sequence, timestamp)?,
        "thread/tokenUsage/updated" => usage_updated_event(params_object, sequence, timestamp)?,
        "item/fileChange/patchUpdated" => {
            file_change_updated_event(params_object, sequence, timestamp)?
        }
        "error" => provider_error_event(params_object, sequence, timestamp)?,
        "warning" | "guardianWarning" => {
            task_notice_event(params_object, sequence, timestamp, &message.method)?
        }
        "autoApprovalReview/strictReviewRequired" => envelope(
            sequence,
            timestamp,
            required_string(params_object, "threadId")?,
            json!({
                "payload": {"code": "strict_review_required", "level": "warning", "message": "Codex requires strict review for subsequent commands."},
                "type": "task.notice",
            }),
        ),
        "thread/goal/updated" => {
            let task_id = required_string(params_object, "threadId")?;
            let goal: NativeGoal = serde_json::from_value(
                params_object
                    .get("goal")
                    .cloned()
                    .ok_or(ConnectionError::InvalidMessage)?,
            )?;
            envelope(
                sequence,
                timestamp,
                task_id,
                json!({
                    "payload": {"goal": map_native_goal(goal, task_id)?},
                    "type": "goal.updated",
                }),
            )
        }
        "thread/goal/cleared" => envelope(
            sequence,
            timestamp,
            required_string(params_object, "threadId")?,
            json!({"payload": {}, "type": "goal.cleared"}),
        ),
        "thread/queue/changed" => envelope(
            sequence,
            timestamp,
            required_string(params_object, "threadId")?,
            json!({"payload": {}, "type": "queue.changed"}),
        ),
        "item/started" | "item/completed" => {
            let native_item = params_object
                .get("item")
                .cloned()
                .ok_or(ConnectionError::InvalidMessage)?;
            let item_id = native_item
                .as_object()
                .and_then(|item| item.get("id"))
                .and_then(Value::as_str)
                .ok_or(ConnectionError::InvalidMessage)?
                .to_owned();
            let started = message.method == "item/started";
            let mut item = map_item(native_item)?;
            apply_transient_item_lifecycle(&mut item, started);
            envelope(
                sequence,
                timestamp,
                required_string(params_object, "threadId")?,
                json!({
                    "itemId": item_id,
                    "payload": {"item": item},
                    "turnId": required_string(params_object, "turnId")?,
                    "type": if started {"item.started"} else {"item.completed"},
                }),
            )
        }
        _ => return Ok(None),
    };
    Ok(Some(event))
}

fn plan_updated_event(
    params: &Map<String, Value>,
    sequence: u64,
    timestamp: &str,
) -> Result<Value, ConnectionError> {
    let steps = params
        .get("plan")
        .and_then(Value::as_array)
        .ok_or(ConnectionError::InvalidMessage)?
        .iter()
        .map(|step| {
            let step = step.as_object().ok_or(ConnectionError::InvalidMessage)?;
            let status = match required_string(step, "status")? {
                "pending" => "pending",
                "inProgress" => "in_progress",
                "completed" => "completed",
                _ => return Err(ConnectionError::InvalidMessage),
            };
            Ok(json!({"status": status, "text": required_string(step, "step")?}))
        })
        .collect::<Result<Vec<_>, ConnectionError>>()?;
    Ok(envelope(
        sequence,
        timestamp,
        required_string(params, "threadId")?,
        json!({
            "payload": {
                "plan": {"explanation": params.get("explanation").cloned().unwrap_or(Value::Null), "steps": steps}
            },
            "turnId": required_string(params, "turnId")?,
            "type": "plan.updated",
        }),
    ))
}

fn usage_updated_event(
    params: &Map<String, Value>,
    sequence: u64,
    timestamp: &str,
) -> Result<Value, ConnectionError> {
    let usage = params
        .get("tokenUsage")
        .and_then(Value::as_object)
        .ok_or(ConnectionError::InvalidMessage)?;
    // `total` 是线程累计消耗；当前上下文占用必须与 Codex TUI 一样读取最近一次用量。
    let last = usage
        .get("last")
        .and_then(Value::as_object)
        .ok_or(ConnectionError::InvalidMessage)?;
    Ok(envelope(
        sequence,
        timestamp,
        required_string(params, "threadId")?,
        json!({
            "payload": {"usage": {
                "contextWindow": usage.get("modelContextWindow").cloned().unwrap_or(Value::Null),
                "usedTokens": required_u64(last, "totalTokens")?,
            }},
            "turnId": required_string(params, "turnId")?,
            "type": "usage.updated",
        }),
    ))
}

fn provider_error_event(
    params: &Map<String, Value>,
    sequence: u64,
    timestamp: &str,
) -> Result<Value, ConnectionError> {
    let error = params
        .get("error")
        .and_then(Value::as_object)
        .ok_or(ConnectionError::InvalidMessage)?;
    let (code, http_status_code) = map_codex_error_info(error.get("codexErrorInfo"));
    let mut payload = json!({
        "code": code,
        "message": required_string(error, "message")?,
        "willRetry": params.get("willRetry").and_then(Value::as_bool).ok_or(ConnectionError::InvalidMessage)?,
    });
    if let Some(status) = http_status_code {
        payload["httpStatusCode"] = Value::from(status);
    }
    Ok(envelope(
        sequence,
        timestamp,
        required_string(params, "threadId")?,
        json!({
            "payload": payload,
            "turnId": required_string(params, "turnId")?,
            "type": "provider.error",
        }),
    ))
}

fn map_codex_error_info(value: Option<&Value>) -> (&'static str, Option<u64>) {
    // 将上游开放枚举收敛为稳定 IPC 分类；未知新值继续以 other 安全展示。
    let code = match value.and_then(Value::as_str) {
        Some("contextWindowExceeded") => "context_window_exceeded",
        Some("sessionBudgetExceeded") => "session_budget_exceeded",
        Some("usageLimitExceeded") => "usage_limit_exceeded",
        Some("rateLimitExceeded") => "rate_limit_exceeded",
        Some("serverOverloaded") => "server_overloaded",
        Some("cyberPolicy" | "misalignmentPolicyViolation") => "policy_blocked",
        Some("internalServerError") => "internal_error",
        Some("unauthorized") => "unauthorized",
        Some("badRequest") => "bad_request",
        Some("sandboxError") => "sandbox_error",
        Some(_) | None => "other",
    };
    let Some(info) = value.and_then(Value::as_object) else {
        return (code, None);
    };
    for variant in [
        "httpConnectionFailed",
        "responseStreamConnectionFailed",
        "responseStreamDisconnected",
        "responseTooManyFailedAttempts",
    ] {
        if let Some(details) = info.get(variant).and_then(Value::as_object) {
            let status = details
                .get("httpStatusCode")
                .and_then(Value::as_u64)
                .filter(|status| (100..=599).contains(status));
            return ("connection_failed", status);
        }
    }
    ("other", None)
}

fn file_change_updated_event(
    params: &Map<String, Value>,
    sequence: u64,
    timestamp: &str,
) -> Result<Value, ConnectionError> {
    let native_changes = params
        .get("changes")
        .and_then(Value::as_array)
        .ok_or(ConnectionError::InvalidMessage)?;
    let original_byte_length = native_changes
        .iter()
        .filter_map(|change| change.get("diff").and_then(Value::as_str))
        .map(str::len)
        .sum::<usize>();
    let mut remaining = MAX_REALTIME_DIFF_BYTES;
    let mut normalized_truncated = false;
    let mut changes = Vec::with_capacity(native_changes.len().min(MAX_REALTIME_FILE_CHANGES));
    for change in native_changes.iter().take(MAX_REALTIME_FILE_CHANGES) {
        let change = change.as_object().ok_or(ConnectionError::InvalidMessage)?;
        let kind = change
            .get("kind")
            .and_then(Value::as_object)
            .and_then(|kind| kind.get("type"))
            .and_then(Value::as_str)
            .ok_or(ConnectionError::InvalidMessage)?;
        let source = required_string(change, "diff")?;
        let kind = match kind {
            "add" => "create",
            "delete" => "delete",
            "update" => "update",
            _ => return Err(ConnectionError::InvalidMessage),
        };
        let path = required_string(change, "path")?;
        let patch = crate::domain::file_patch::FilePatch::codex(path, kind, source, remaining);
        normalized_truncated |= patch.truncated;
        remaining = remaining.saturating_sub(patch.diff.len());
        changes.push(json!({
            "stats": crate::domain::file_change::FileChangeStats::patch(&patch.diff),
            "diff": patch.diff,
            "kind": kind,
            "path": path,
        }));
    }
    let truncated = normalized_truncated
        || native_changes.len() > changes.len()
        || original_byte_length > MAX_REALTIME_DIFF_BYTES;
    Ok(envelope(
        sequence,
        timestamp,
        required_string(params, "threadId")?,
        json!({
            "itemId": required_string(params, "itemId")?,
            "payload": {"changes": changes, "originalByteLength": original_byte_length, "truncated": truncated},
            "turnId": required_string(params, "turnId")?,
            "type": "file_change.updated",
        }),
    ))
}

fn task_notice_event(
    params: &Map<String, Value>,
    sequence: u64,
    timestamp: &str,
    method: &str,
) -> Result<Value, ConnectionError> {
    Ok(envelope(
        sequence,
        timestamp,
        required_string(params, "threadId")?,
        json!({
            "payload": {
                "code": if method == "guardianWarning" {"guardian_warning"} else {"runtime_warning"},
                "level": "warning",
                "message": required_string(params, "message")?,
            },
            "type": "task.notice",
        }),
    ))
}

pub fn map_server_event_now(
    message: ServerMessage,
    sequence: u64,
) -> Result<Option<AgentEvent>, ConnectionError> {
    let elapsed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| ConnectionError::StateUnavailable)?;
    let received_at_unix_ms =
        u64::try_from(elapsed.as_millis()).map_err(|_| ConnectionError::StateUnavailable)?;
    let seconds = elapsed.as_secs();
    let seconds = i64::try_from(seconds).map_err(|_| ConnectionError::StateUnavailable)?;
    let timestamp = unix_seconds_to_rfc3339(seconds);

    // Delta 直接从 RawValue 映射到强类型事件，避免构建临时 JSON 树。
    if let Some(event) = map_delta_message(&message, sequence, &timestamp, received_at_unix_ms)? {
        return Ok(Some(AgentEvent::Delta(event)));
    }
    map_server_message(message, sequence, &timestamp).map(|event| event.map(AgentEvent::Json))
}

fn delta_event(
    params: &Map<String, Value>,
    sequence: u64,
    timestamp: &str,
    event_type: &str,
    extra_payload: Option<Value>,
) -> Result<Value, ConnectionError> {
    let mut payload = json!({"delta": required_string(params, "delta")?});
    if let (Some(payload), Some(extra)) = (payload.as_object_mut(), extra_payload) {
        let extra = extra.as_object().ok_or(ConnectionError::InvalidMessage)?;
        payload.extend(extra.clone());
    }
    Ok(envelope(
        sequence,
        timestamp,
        required_string(params, "threadId")?,
        json!({
            "itemId": required_string(params, "itemId")?,
            "payload": payload,
            "turnId": required_string(params, "turnId")?,
            "type": event_type,
        }),
    ))
}

pub(super) fn envelope(sequence: u64, timestamp: &str, task_id: &str, fields: Value) -> Value {
    let mut event = json!({
        "provider": "codex",
        "sequence": sequence,
        "sessionId": RUNTIME_SESSION_ID,
        "taskId": task_id,
        "timestamp": timestamp,
        "version": 2,
    });
    if let (Some(event), Some(fields)) = (event.as_object_mut(), fields.as_object()) {
        event.extend(fields.clone());
    }
    event
}

pub(super) fn required_string<'a>(
    object: &'a Map<String, Value>,
    key: &str,
) -> Result<&'a str, ConnectionError> {
    object
        .get(key)
        .and_then(Value::as_str)
        .ok_or(ConnectionError::InvalidMessage)
}

pub(super) fn required_u64(object: &Map<String, Value>, key: &str) -> Result<u64, ConnectionError> {
    object
        .get(key)
        .and_then(Value::as_u64)
        .ok_or(ConnectionError::InvalidMessage)
}
