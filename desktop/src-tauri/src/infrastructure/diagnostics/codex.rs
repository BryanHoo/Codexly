use std::collections::BTreeMap;

use serde_json::Value;
use thiserror::Error;

use super::{
    DiagnosticEvent, DiagnosticLevel, DiagnosticSession, DiagnosticSource,
    redaction::{sanitize_context, sanitize_event_code, sanitize_text},
};

pub const MAX_CODEX_LOG_LINE_BYTES: usize = 64 * 1024;

#[derive(Debug, Error, Eq, PartialEq)]
pub enum CodexLogParseError {
    #[error("Codex log line is not valid JSON")]
    InvalidJson,
    #[error("Codex log line has an invalid structure")]
    InvalidStructure,
    #[error("Codex log line exceeds the size limit")]
    TooLarge,
}

pub fn parse_codex_event(
    line: &[u8],
    session: &DiagnosticSession,
) -> Result<Option<DiagnosticEvent>, CodexLogParseError> {
    if line.len() > MAX_CODEX_LOG_LINE_BYTES {
        return Err(CodexLogParseError::TooLarge);
    }
    let value: Value = serde_json::from_slice(line).map_err(|_| CodexLogParseError::InvalidJson)?;
    let object = value
        .as_object()
        .ok_or(CodexLogParseError::InvalidStructure)?;
    let level = match object.get("level").and_then(Value::as_str) {
        Some("ERROR") => DiagnosticLevel::Error,
        Some("WARN") => DiagnosticLevel::Warn,
        // 普通内部日志不进入队列，避免挤占错误日志与传输预算。
        Some("INFO" | "DEBUG" | "TRACE") => return Ok(None),
        _ => return Err(CodexLogParseError::InvalidStructure),
    };
    let timestamp = object
        .get("timestamp")
        .and_then(Value::as_str)
        .filter(|timestamp| timestamp.len() <= 64 && timestamp.is_ascii())
        .ok_or(CodexLogParseError::InvalidStructure)?;
    let target = object
        .get("target")
        .and_then(Value::as_str)
        .ok_or(CodexLogParseError::InvalidStructure)?;
    let fields = object
        .get("fields")
        .and_then(Value::as_object)
        .ok_or(CodexLogParseError::InvalidStructure)?;
    let message = fields
        .get("message")
        .and_then(Value::as_str)
        .map(|message| sanitize_text(message, 512))
        .filter(|message| !message.is_empty());
    let context = fields
        .iter()
        .filter(|(key, _)| key.as_str() != "message" && key.as_str() != "event.name")
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect::<BTreeMap<_, _>>();
    let event_suffix = fields
        .get("event.name")
        .and_then(Value::as_str)
        .unwrap_or(target);
    let event = format!(
        "codex.{}",
        sanitize_event_code(&event_suffix.replace("::", "."), "internal_event")
    );

    Ok(Some(DiagnosticEvent {
        context: sanitize_context(context, session),
        event,
        level,
        message,
        schema_version: 1,
        session_id: session.id.clone(),
        source: DiagnosticSource::Codex,
        stack: None,
        timestamp: timestamp.to_owned(),
    }))
}
