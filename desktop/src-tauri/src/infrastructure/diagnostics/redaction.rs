use std::collections::BTreeMap;

use serde_json::Value;
use sha2::{Digest as _, Sha256};

use crate::encoding::encode_lower_hex;

use super::DiagnosticSession;

pub(super) fn sanitize_context(
    context: BTreeMap<String, Value>,
    session: &DiagnosticSession,
) -> BTreeMap<String, Value> {
    context
        .into_iter()
        .filter(|(key, _)| valid_context_key(key) && !sensitive_key(key))
        .filter_map(|(key, value)| {
            sanitize_context_value(&key, value, session).map(|value| (key, value))
        })
        .take(16)
        .collect()
}

pub(super) fn sanitize_event_code(value: &str, fallback: &str) -> String {
    let valid = !value.is_empty()
        && value.len() <= 64
        && value.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || b"_.-".contains(&byte)
        });
    if valid {
        value.to_owned()
    } else {
        fallback.to_owned()
    }
}

pub(super) fn sanitize_text(value: &str, max_chars: usize) -> String {
    let lowercase = value.to_ascii_lowercase();
    if [
        "authorization",
        "bearer ",
        "api_key",
        "apikey",
        "access_token",
        "password",
        "secret",
    ]
    .iter()
    .any(|marker| lowercase.contains(marker))
    {
        return "[redacted sensitive text]".to_owned();
    }

    value
        .split_whitespace()
        .map(|token| {
            if looks_like_path_or_url(token) {
                "[path]"
            } else {
                token
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(max_chars)
        .collect()
}

fn sanitize_context_value(key: &str, value: Value, session: &DiagnosticSession) -> Option<Value> {
    let normalized = key.to_ascii_lowercase();
    if key == "rpcMethod" {
        // RPC 方法名是固定协议标识，先校验字符集再保留其中合法的 `/`。
        return value
            .as_str()
            .filter(|value| valid_rpc_method(value))
            .map(|value| Value::String(value.to_owned()));
    }
    if normalized.contains("path") || normalized == "cwd" {
        return Some(Value::String("[path]".to_owned()));
    }
    if normalized.ends_with("id") || normalized.ends_with("_id") {
        return value
            .as_str()
            .map(|value| Value::String(hash_identifier(key, value, session)));
    }
    match value {
        Value::String(value) => Some(Value::String(sanitize_text(&value, 512))),
        Value::Bool(_) | Value::Null | Value::Number(_) => Some(value),
        Value::Array(_) | Value::Object(_) => None,
    }
}

fn valid_rpc_method(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'/' | b'.' | b'_' | b'-'))
}

fn hash_identifier(key: &str, value: &str, session: &DiagnosticSession) -> String {
    let mut hasher = Sha256::new();
    hasher.update(session.salt);
    hasher.update(key.as_bytes());
    hasher.update(value.as_bytes());
    let digest = hasher.finalize();
    encode_lower_hex(&digest[..12])
}

pub(super) fn pseudonymize_identifier(
    key: &str,
    value: &str,
    session: &DiagnosticSession,
) -> String {
    hash_identifier(key, value, session)
}

fn valid_context_key(key: &str) -> bool {
    !key.is_empty()
        && key.len() <= 64
        && key
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'.' | b'-'))
}

fn sensitive_key(key: &str) -> bool {
    let normalized = key.to_ascii_lowercase();
    [
        "authorization",
        "cookie",
        "credential",
        "password",
        "prompt",
        "response",
        "secret",
        "token",
    ]
    .iter()
    .any(|marker| normalized.contains(marker))
}

fn looks_like_path_or_url(token: &str) -> bool {
    let trimmed = token.trim_start_matches(['(', '[', '{', '\'', '"']);
    trimmed.starts_with('/')
        || trimmed.starts_with("~/")
        || trimmed.starts_with("\\\\")
        || trimmed.contains('/')
        || trimmed.contains('\\')
        || trimmed.contains("://")
        || (trimmed.as_bytes().get(1) == Some(&b':')
            && trimmed
                .as_bytes()
                .get(2)
                .is_some_and(|byte| matches!(byte, b'/' | b'\\')))
}
