use std::{collections::BTreeMap, time::Duration};

use serde_json::{Value, json};

use super::connection::ConnectionError;
use crate::infrastructure::diagnostics::{self, DiagnosticLevel};

type RpcDiagnostic = (
    DiagnosticLevel,
    &'static str,
    Option<String>,
    BTreeMap<String, Value>,
);

static NEXT_CONNECTION: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
static NEXT_OPERATION: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

pub(super) fn next_connection_seq() -> u64 {
    NEXT_CONNECTION.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
}

pub(super) struct RpcObservation<'a> {
    method: &'a str,
    connection_seq: u64,
    operation_seq: u64,
    started: tokio::time::Instant,
    timeout: Duration,
    finished: bool,
    pub(super) request_seq: Option<u64>,
    pub(super) retry_count: u32,
    pub(super) phase: &'static str,
}

impl<'a> RpcObservation<'a> {
    pub(super) fn start(method: &'a str, connection_seq: u64, timeout: Duration) -> Self {
        let observation = Self {
            method,
            connection_seq,
            timeout,
            operation_seq: NEXT_OPERATION.fetch_add(1, std::sync::atomic::Ordering::Relaxed),
            started: tokio::time::Instant::now(),
            finished: false,
            request_seq: None,
            retry_count: 0,
            phase: "encode",
        };
        if key_operation(method) {
            observation.emit(
                DiagnosticLevel::Info,
                "codex_rpc_request_started",
                None,
                BTreeMap::new(),
            );
        }
        observation
    }

    fn emit(
        &self,
        level: DiagnosticLevel,
        event: &str,
        message: Option<String>,
        mut context: BTreeMap<String, Value>,
    ) {
        context.extend([
            ("connectionSeq".to_owned(), json!(self.connection_seq)),
            ("operationSeq".to_owned(), json!(self.operation_seq)),
            ("rpcMethod".to_owned(), json!(self.method)),
            ("timeoutMs".to_owned(), json!(duration_ms(self.timeout))),
            (
                "elapsedMs".to_owned(),
                json!(duration_ms(self.started.elapsed())),
            ),
            ("retryCount".to_owned(), json!(self.retry_count)),
            ("phase".to_owned(), json!(self.phase)),
        ]);
        if let Some(request_seq) = self.request_seq {
            context.insert("requestSeq".to_owned(), json!(request_seq));
        }
        diagnostics::record(level, event, message, context);
    }

    pub(super) fn finish<T>(&mut self, result: &Result<T, ConnectionError>) {
        self.finished = true;
        if let Some((level, event, message, context)) = rpc_diagnostic(
            self.method,
            result.as_ref().err(),
            self.started.elapsed(),
            self.retry_count,
        ) {
            self.emit(level, event, message, context);
        }
    }
}

impl Drop for RpcObservation<'_> {
    fn drop(&mut self) {
        // Future 被调用方取消也要闭合关键操作；普通读取取消不刷屏、不标记为错误。
        if !self.finished && key_operation(self.method) {
            self.emit(
                DiagnosticLevel::Info,
                "codex_rpc_request_cancelled",
                None,
                BTreeMap::new(),
            );
        }
    }
}

fn duration_ms(duration: Duration) -> u64 {
    duration.as_millis().min(u64::MAX as u128) as u64
}

fn key_operation(method: &str) -> bool {
    matches!(
        method,
        "initialize"
            | "thread/start"
            | "thread/resume"
            | "thread/fork"
            | "thread/archive"
            | "turn/start"
            | "turn/interrupt"
            | "turn/steer"
    )
}

fn rpc_diagnostic(
    method: &str,
    error: Option<&ConnectionError>,
    elapsed: Duration,
    retry_count: u32,
) -> Option<RpcDiagnostic> {
    // 普通读取只在慢请求、重试恢复或失败时记录，保持稳定路径低开销。
    let slow = elapsed >= Duration::from_secs(2);
    if error.is_none() && retry_count == 0 && !key_operation(method) && !slow {
        return None;
    }
    let mut context = BTreeMap::from([
        ("rpcMethod".to_owned(), json!(method)),
        (
            "elapsedMs".to_owned(),
            json!(elapsed.as_millis().min(u64::MAX as u128) as u64),
        ),
        ("retryCount".to_owned(), json!(retry_count)),
    ]);
    if let Some(error) = error {
        let kind = match error {
            ConnectionError::Json(_) => "json",
            ConnectionError::Write(_) => "write",
            ConnectionError::Request { code, .. } => {
                context.insert("rpcCode".to_owned(), json!(code));
                "rpc"
            }
            ConnectionError::ConnectionClosed => "connection_closed",
            ConnectionError::InvalidMessage => "invalid_message",
            ConnectionError::Timeout => "timeout",
            ConnectionError::StateUnavailable => "state_unavailable",
        };
        context.insert("errorKind".to_owned(), json!(kind));
        let message = match error {
            ConnectionError::Request { message, .. } => message.clone(),
            _ => error.to_string(),
        };
        return Some((
            DiagnosticLevel::Error,
            "codex_rpc_request_failed",
            Some(message),
            context,
        ));
    }
    if slow {
        return Some((
            DiagnosticLevel::Warn,
            "codex_rpc_request_slow",
            None,
            context,
        ));
    }
    let event = if retry_count > 0 {
        "codex_rpc_request_recovered"
    } else {
        "codex_rpc_request_completed"
    };
    Some((DiagnosticLevel::Info, event, None, context))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn diagnostic_slow_reads_are_visible_without_logging_fast_reads() {
        let event = rpc_diagnostic("thread/read", None, Duration::from_secs(2), 0).unwrap();
        assert_eq!(event.0, DiagnosticLevel::Warn);
        assert_eq!(event.1, "codex_rpc_request_slow");
    }

    #[test]
    fn rpc_error_preserves_protocol_details() {
        let error = ConnectionError::Request {
            code: -32600,
            message: "invalid value: expected TOML value".to_owned(),
        };
        let (_, _, message, context) =
            rpc_diagnostic("config/batchWrite", Some(&error), Duration::ZERO, 0).unwrap();
        assert_eq!(context["rpcCode"], json!(-32600));
        assert_eq!(context["rpcMethod"], json!("config/batchWrite"));
        assert_eq!(
            message.as_deref(),
            Some("invalid value: expected TOML value")
        );
    }

    #[test]
    fn rpc_diagnostics_cover_transport_errors_and_timing() {
        for error in [
            ConnectionError::Timeout,
            ConnectionError::ConnectionClosed,
            ConnectionError::InvalidMessage,
            ConnectionError::StateUnavailable,
            ConnectionError::Write(std::io::Error::other("broken pipe")),
        ] {
            let (level, event, message, context) =
                rpc_diagnostic("turn/start", Some(&error), Duration::from_millis(150), 2).unwrap();
            assert_eq!(level, DiagnosticLevel::Error);
            assert_eq!(event, "codex_rpc_request_failed");
            assert_eq!(message, Some(error.to_string()));
            assert_eq!(context["elapsedMs"], json!(150));
            assert_eq!(context["retryCount"], json!(2));
            assert!(context.contains_key("errorKind"));
        }
    }

    #[test]
    fn rpc_diagnostics_keep_key_operations_and_recovery_without_read_noise() {
        assert!(rpc_diagnostic("thread/read", None, Duration::from_millis(20), 0).is_none());
        for method in [
            "initialize",
            "thread/start",
            "thread/resume",
            "turn/start",
            "turn/interrupt",
        ] {
            assert_eq!(
                rpc_diagnostic(method, None, Duration::from_millis(20), 0)
                    .unwrap()
                    .0,
                DiagnosticLevel::Info
            );
        }
        assert_eq!(
            rpc_diagnostic("thread/read", None, Duration::from_millis(20), 1)
                .unwrap()
                .1,
            "codex_rpc_request_recovered"
        );
    }
}
