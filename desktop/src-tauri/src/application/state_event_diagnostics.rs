use std::collections::BTreeMap;

use serde_json::{Value, json};

use crate::{
    domain::runtime::AgentEvent,
    infrastructure::diagnostics::{self, DiagnosticLevel},
};

pub(super) fn is_diagnostic_event(event: &AgentEvent) -> bool {
    matches!(
        event.event_type(),
        Some("turn.started" | "turn.completed" | "provider.error")
    )
}

pub(super) fn record_task_event(event: &AgentEvent, project_id: &str, connection_seq: Option<u64>) {
    // 流式正文、命令输出和逐项状态不进入日志，避免复制高频或敏感内容。
    if !is_diagnostic_event(event) {
        return;
    }
    let Some(value) = event.as_json() else {
        return;
    };
    let mut context = BTreeMap::from([
        ("projectId".to_owned(), json!(project_id)),
        ("taskId".to_owned(), value["taskId"].clone()),
        ("turnId".to_owned(), value["turnId"].clone()),
        ("eventSequence".to_owned(), value["sequence"].clone()),
        ("connectionSeq".to_owned(), json!(connection_seq)),
    ]);
    let payload = &value["payload"];
    let (level, name, message) = if event.event_type() == Some("provider.error") {
        for field in ["code", "httpStatusCode", "willRetry"] {
            if let Some(value) = payload.get(field) {
                context.insert(field.to_owned(), value.clone());
            }
        }
        (
            if payload["willRetry"] == true {
                DiagnosticLevel::Warn
            } else {
                DiagnosticLevel::Error
            },
            "agent_provider_error",
            payload["message"].as_str(),
        )
    } else {
        let turn = &payload["turn"];
        context.insert("status".to_owned(), turn["status"].clone());
        (
            if turn["status"] == "failed" {
                DiagnosticLevel::Error
            } else {
                DiagnosticLevel::Info
            },
            if event.event_type() == Some("turn.started") {
                "agent_turn_started"
            } else {
                "agent_turn_completed"
            },
            turn.get("error").and_then(Value::as_str),
        )
    };
    diagnostics::record(level, name, message.map(str::to_owned), context);
}
