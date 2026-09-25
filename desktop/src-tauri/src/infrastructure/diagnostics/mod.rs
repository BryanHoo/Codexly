mod codex;
mod export;
mod redaction;

use std::{
    collections::BTreeMap,
    fmt::Display,
    fs,
    path::{Path, PathBuf},
    sync::{Once, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager as _, Runtime, plugin::TauriPlugin};
use tauri_plugin_log::{Builder, RotationStrategy, Target, TargetKind};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};

use crate::encoding::encode_lower_hex;

pub use codex::{CodexLogParseError, MAX_CODEX_LOG_LINE_BYTES, parse_codex_event};
pub use export::write_diagnostic_archive;

const LOG_TARGET: &str = "codeagent";
const RUNNING_MARKER: &str = ".codeagent-running";
static SESSION: OnceLock<DiagnosticSession> = OnceLock::new();
static PANIC_HOOK: Once = Once::new();

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DiagnosticLevel {
    Debug,
    Error,
    Info,
    Warn,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DiagnosticSource {
    Codex,
    Rust,
    Webview,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrontendDiagnosticInput {
    pub context: BTreeMap<String, Value>,
    pub error_message: Option<String>,
    pub event: String,
    pub level: DiagnosticLevel,
    pub stack: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticEvent {
    pub context: BTreeMap<String, Value>,
    pub event: String,
    pub level: DiagnosticLevel,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    pub schema_version: u16,
    pub session_id: String,
    pub source: DiagnosticSource,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stack: Option<String>,
    pub timestamp: String,
}

#[derive(Clone, Debug)]
pub struct DiagnosticSession {
    id: String,
    salt: [u8; 32],
}

impl DiagnosticSession {
    fn new() -> Self {
        let seed = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or_default();
        let digest = Sha256::digest(format!("{seed}:{}", std::process::id()).as_bytes());
        let mut salt = [0_u8; 32];
        salt.copy_from_slice(&digest);
        Self {
            id: encode_lower_hex(&digest[..12]),
            salt,
        }
    }

    #[cfg(test)]
    fn fixed() -> Self {
        Self {
            id: "session-test".to_owned(),
            salt: [7; 32],
        }
    }
}

#[cfg_attr(feature = "webview-tests", allow(dead_code))]
pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    let file_target = Target::new(TargetKind::LogDir {
        file_name: Some("codeagent".to_owned()),
    });
    let mut builder = Builder::new()
        .clear_targets()
        .target(file_target)
        .clear_format()
        .filter(|metadata| metadata.target() == LOG_TARGET)
        .level(log::LevelFilter::Info)
        .max_file_size(5 * 1024 * 1024)
        .rotation_strategy(RotationStrategy::KeepSome(5));
    if cfg!(debug_assertions) {
        builder = builder.target(Target::new(TargetKind::Stdout));
    }
    builder.build()
}

pub fn initialize<R: Runtime>(app: &AppHandle<R>) -> Result<(), std::io::Error> {
    let log_dir = app.path().app_log_dir().map_err(std::io::Error::other)?;
    fs::create_dir_all(&log_dir)?;
    let marker = marker_path(&log_dir);
    if marker.exists() {
        record(
            DiagnosticLevel::Warn,
            "previous_session_unclean",
            None,
            BTreeMap::new(),
        );
    }
    fs::write(marker, session().id.as_bytes())?;
    install_panic_hook();
    record(
        DiagnosticLevel::Info,
        "app_started",
        None,
        BTreeMap::from([
            (
                "appVersion".to_owned(),
                json!(app.package_info().version.to_string()),
            ),
            ("arch".to_owned(), json!(std::env::consts::ARCH)),
            ("os".to_owned(), json!(std::env::consts::OS)),
        ]),
    );
    Ok(())
}

pub fn mark_clean_shutdown<R: Runtime>(app: &AppHandle<R>) {
    record(DiagnosticLevel::Info, "app_stopped", None, BTreeMap::new());
    if let Ok(log_dir) = app.path().app_log_dir() {
        let _ = fs::remove_file(marker_path(&log_dir));
    }
    log::logger().flush();
}

pub fn session() -> &'static DiagnosticSession {
    SESSION.get_or_init(DiagnosticSession::new)
}

pub fn pseudonymize_identifier(key: &str, value: &str) -> String {
    redaction::pseudonymize_identifier(key, value, session())
}

pub fn record_frontend_event(input: FrontendDiagnosticInput) {
    emit(sanitize_frontend_event(input, session(), &timestamp()));
}

pub fn record_codex_event(event: DiagnosticEvent) {
    emit(event);
}

#[track_caller]
pub fn record_error(event: &str, error: impl Display) {
    record(
        DiagnosticLevel::Error,
        event,
        Some(error.to_string()),
        BTreeMap::new(),
    );
}

#[track_caller]
pub fn record_error_chain(event: &str, error: &dyn std::error::Error) {
    let mut context = BTreeMap::new();
    let mut cause = error.source();
    // 分字段保留有限错误链，避免顶层包装信息遮蔽操作系统原因或异常链无限增长。
    for index in 1..=4 {
        let Some(error) = cause else {
            break;
        };
        context.insert(format!("cause{index}"), json!(error.to_string()));
        cause = error.source();
    }
    record(
        DiagnosticLevel::Error,
        event,
        Some(error.to_string()),
        context,
    );
}

#[track_caller]
pub fn record(
    level: DiagnosticLevel,
    event: &str,
    message: Option<String>,
    mut context: BTreeMap<String, Value>,
) {
    if level == DiagnosticLevel::Debug {
        return;
    }
    if matches!(level, DiagnosticLevel::Warn | DiagnosticLevel::Error) {
        let caller = std::panic::Location::caller();
        // 仅保留源文件名与行号，不泄漏编译机器目录。
        let source = Path::new(caller.file())
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("unknown");
        context.insert("sourceFile".to_owned(), json!(source));
        context.insert("sourceLine".to_owned(), json!(caller.line()));
    }
    emit(rust_event(
        level,
        event,
        message,
        context,
        session(),
        &timestamp(),
    ));
}

fn rust_event(
    level: DiagnosticLevel,
    event: &str,
    message: Option<String>,
    context: BTreeMap<String, Value>,
    session: &DiagnosticSession,
    timestamp: &str,
) -> DiagnosticEvent {
    DiagnosticEvent {
        context: redaction::sanitize_context(context, session),
        event: redaction::sanitize_event_code(event, "invalid_rust_event"),
        level,
        message: message
            .as_deref()
            .map(|message| redaction::sanitize_text(message, 512))
            .filter(|message| !message.is_empty()),
        schema_version: 1,
        session_id: session.id.clone(),
        source: DiagnosticSource::Rust,
        stack: None,
        timestamp: timestamp.to_owned(),
    }
}

fn emit(event: DiagnosticEvent) {
    // 在序列化之前跳过调试事件，开发构建也保持与发布构建一致的日志密度。
    if event.level == DiagnosticLevel::Debug {
        return;
    }
    let Ok(serialized) = serde_json::to_string(&event) else {
        return;
    };
    match event.level {
        DiagnosticLevel::Debug => log::debug!(target: LOG_TARGET, "{serialized}"),
        DiagnosticLevel::Info => log::info!(target: LOG_TARGET, "{serialized}"),
        DiagnosticLevel::Warn => log::warn!(target: LOG_TARGET, "{serialized}"),
        DiagnosticLevel::Error => log::error!(target: LOG_TARGET, "{serialized}"),
    }
}

fn install_panic_hook() {
    PANIC_HOOK.call_once(|| {
        let previous = std::panic::take_hook();
        std::panic::set_hook(Box::new(move |panic_info| {
            record_error("rust_panic", panic_info);
            log::logger().flush();
            previous(panic_info);
        }));
    });
}

fn timestamp() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_owned())
}

fn marker_path(log_dir: &Path) -> PathBuf {
    log_dir.join(RUNNING_MARKER)
}

pub fn sanitize_frontend_event(
    input: FrontendDiagnosticInput,
    session: &DiagnosticSession,
    timestamp: &str,
) -> DiagnosticEvent {
    DiagnosticEvent {
        context: redaction::sanitize_context(input.context, session),
        event: redaction::sanitize_event_code(&input.event, "invalid_frontend_event"),
        level: input.level,
        message: input
            .error_message
            .as_deref()
            .map(|message| redaction::sanitize_text(message, 512))
            .filter(|message| !message.is_empty()),
        schema_version: 1,
        session_id: session.id.clone(),
        source: DiagnosticSource::Webview,
        stack: input
            .stack
            .as_deref()
            .map(|stack| redaction::sanitize_text(stack, 2_048))
            .filter(|stack| !stack.is_empty()),
        timestamp: timestamp.to_owned(),
    }
}

#[cfg(test)]
mod tests;

#[cfg(test)]
pub(crate) mod test_support;
