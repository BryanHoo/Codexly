#[test]
fn crash_artifacts_are_included_in_existing_diagnostic_export() {
    let dir = tempfile::tempdir().unwrap();
    for name in [
        "codeagent-emergency.log",
        "codeagent-emergency-previous.log",
        "codeagent-host-0123456789abcdef01234567.log",
    ] {
        std::fs::write(dir.path().join(name), b"{}\n").unwrap();
    }
    let destination = dir.path().join("diagnostics.zip");
    super::write_diagnostic_archive(
        &destination,
        dir.path(),
        &serde_json::json!({}),
        &serde_json::json!({}),
    )
    .unwrap();
    let mut archive = zip::ZipArchive::new(std::fs::File::open(destination).unwrap()).unwrap();
    assert!(archive.by_name("logs/codeagent-emergency.log").is_ok());
    assert!(
        archive
            .by_name("logs/codeagent-emergency-previous.log")
            .is_ok()
    );
    assert!(
        archive
            .by_name("logs/codeagent-host-0123456789abcdef01234567.log")
            .is_ok()
    );
}

use std::{
    collections::BTreeMap,
    fs,
    io::Read as _,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

use serde_json::{Value, json};

use super::{
    DiagnosticLevel, DiagnosticSession, DiagnosticSource, FrontendDiagnosticInput,
    sanitize_frontend_event, write_diagnostic_archive,
};

#[test]
fn frontend_event_removes_secrets_paths_and_raw_identifiers() {
    let event = sanitize_frontend_event(
        FrontendDiagnosticInput {
            context: BTreeMap::from([
                ("projectId".to_owned(), json!("project-secret")),
                ("rootPath".to_owned(), json!("/Users/alice/private-project")),
                ("retryCount".to_owned(), json!(2)),
                ("token".to_owned(), json!("sk-secret")),
            ]),
            error_message: Some(
                "failed at /Users/alice/private-project\nAuthorization: Bearer sk-secret"
                    .to_owned(),
            ),
            event: "event_connection_failed".to_owned(),
            level: DiagnosticLevel::Warn,
            stack: Some("at Project (/Users/alice/private-project/src/App.tsx:10)".to_owned()),
        },
        &DiagnosticSession::fixed(),
        "2026-09-01T08:00:00Z",
    );

    let serialized = serde_json::to_string(&event).unwrap();
    assert_eq!(event.schema_version, 1);
    assert_eq!(event.source, DiagnosticSource::Webview);
    assert_eq!(event.event, "event_connection_failed");
    assert_eq!(event.context["retryCount"], json!(2));
    assert_ne!(event.context["projectId"], json!("project-secret"));
    for secret in ["/Users/alice", "private-project", "sk-secret", "Bearer"] {
        assert!(
            !serialized.contains(secret),
            "leaked {secret}: {serialized}"
        );
    }
}

#[test]
fn frontend_event_bounds_untrusted_fields() {
    let context = (0..24)
        .map(|index| (format!("field{index}"), Value::String("x".repeat(1_000))))
        .collect();
    let event = sanitize_frontend_event(
        FrontendDiagnosticInput {
            context,
            error_message: Some("x".repeat(2_000)),
            event: "INVALID EVENT WITH SPACES".to_owned(),
            level: DiagnosticLevel::Error,
            stack: None,
        },
        &DiagnosticSession::fixed(),
        "2026-09-01T08:00:00Z",
    );

    assert_eq!(event.event, "invalid_frontend_event");
    assert!(event.context.len() <= 16);
    assert!(event.message.as_ref().unwrap().chars().count() <= 512);
    assert!(event.context.values().all(|value| {
        value
            .as_str()
            .is_none_or(|value| value.chars().count() <= 512)
    }));
}

#[test]
fn diagnostic_archive_contains_only_allowlisted_artifacts() {
    let root = temporary_directory("archive");
    let log_dir = root.join("logs");
    fs::create_dir_all(&log_dir).unwrap();
    fs::write(
        log_dir.join("codeagent.log"),
        b"{\"event\":\"app_started\"}\n",
    )
    .unwrap();
    fs::write(
        log_dir.join("codeagent.2026-08-31.log"),
        b"{\"event\":\"previous\"}\n",
    )
    .unwrap();
    fs::write(log_dir.join("app.json"), br#"{"token":"must-not-export"}"#).unwrap();
    let destination = root.join("diagnostics.zip");

    let summary = write_diagnostic_archive(
        &destination,
        &log_dir,
        &json!({
            "appVersion": "0.1.0",
            "schemaVersion": 1
        }),
        &json!({
            "projects": [{"projectRef": "hashed", "queueHighWatermark": 4}],
            "version": 1
        }),
    )
    .unwrap();

    assert_eq!(summary.log_files, 2);
    let file = fs::File::open(&destination).unwrap();
    let mut archive = zip::ZipArchive::new(file).unwrap();
    let names = (0..archive.len())
        .map(|index| {
            archive
                .by_index(index)
                .unwrap()
                .name()
                .unwrap()
                .into_owned()
        })
        .collect::<Vec<_>>();
    assert_eq!(
        names,
        [
            "README.txt",
            "manifest.json",
            "metrics/runtime.json",
            "logs/codeagent.2026-08-31.log",
            "logs/codeagent.log",
        ]
    );
    let mut readme = String::new();
    archive
        .by_name("README.txt")
        .unwrap()
        .read_to_string(&mut readme)
        .unwrap();
    assert!(readme.starts_with("Codexly diagnostics archive"));
    let mut contents = String::new();
    archive
        .by_name("manifest.json")
        .unwrap()
        .read_to_string(&mut contents)
        .unwrap();
    assert!(contents.contains("0.1.0"));
    assert!(!names.iter().any(|name| name.contains("app.json")));

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn diagnostic_archive_rejects_logs_over_the_export_limit() {
    let root = temporary_directory("oversized-archive");
    let log_dir = root.join("logs");
    fs::create_dir_all(&log_dir).unwrap();
    let log = fs::File::create(log_dir.join("codeagent.log")).unwrap();
    log.set_len(32 * 1024 * 1024 + 1).unwrap();

    let error = write_diagnostic_archive(
        &root.join("diagnostics.zip"),
        &log_dir,
        &json!({}),
        &json!({}),
    )
    .unwrap_err();

    assert_eq!(
        error.to_string(),
        "diagnostic logs exceed the export size limit"
    );
    assert!(!root.join("diagnostics.zip").exists());
    fs::remove_dir_all(root).unwrap();
}

fn temporary_directory(label: &str) -> PathBuf {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir().join(format!("codeagent-diagnostics-{label}-{unique}"))
}

#[test]
fn diagnostic_error_records_safe_source_location() {
    let capture = super::test_support::Capture::start();
    super::record_error("test_failure", "broken pipe");
    let events = capture.take();
    assert_eq!(events[0]["context"]["sourceFile"], json!("tests.rs"));
    assert!(events[0]["context"]["sourceLine"].is_u64());
}

#[test]
fn diagnostic_error_chain_keeps_the_os_cause_separately() {
    #[derive(Debug, thiserror::Error)]
    #[error("runtime startup failed")]
    struct StartError(#[source] std::io::Error);
    let capture = super::test_support::Capture::start();
    super::record_error_chain(
        "test_start_failed",
        &StartError(std::io::Error::from_raw_os_error(13)),
    );
    let events = capture.take();
    assert_eq!(events[0]["message"], json!("runtime startup failed"));
    assert!(
        events[0]["context"]["cause1"]
            .as_str()
            .unwrap()
            .contains("13")
    );
}
