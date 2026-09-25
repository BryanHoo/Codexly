use std::{collections::BTreeMap, path::PathBuf};

use serde::Serialize;
use serde_json::{Value, json};
use tauri::{AppHandle, Manager as _, State};
use tauri_plugin_dialog::DialogExt as _;
use time::OffsetDateTime;
use tokio::sync::oneshot;

use super::{error::AppError, state::AppState};
use crate::infrastructure::diagnostics::{
    self, DiagnosticLevel, FrontendDiagnosticInput, write_diagnostic_archive,
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase", tag = "status")]
pub enum ExportDiagnosticsResponse {
    Cancelled,
    Saved { file_name: String },
}

#[tauri::command]
pub fn record_frontend_diagnostic(input: FrontendDiagnosticInput) {
    diagnostics::record_frontend_event(input);
}

#[tauri::command]
pub async fn export_diagnostics(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ExportDiagnosticsResponse, AppError> {
    let file_name = format!(
        "codexly-diagnostics-{}.zip",
        OffsetDateTime::now_utc().unix_timestamp()
    );
    let (sender, receiver) = oneshot::channel();
    app.dialog()
        .file()
        .add_filter("ZIP archive", &["zip"])
        .set_file_name(&file_name)
        .save_file(move |path| {
            let _ = sender.send(path);
        });
    let selected = receiver
        .await
        .map_err(|_| AppError::DiagnosticsExportFailed)?;
    let Some(selected) = selected else {
        diagnostics::record(
            DiagnosticLevel::Info,
            "diagnostics_export_cancelled",
            None,
            BTreeMap::new(),
        );
        return Ok(ExportDiagnosticsResponse::Cancelled);
    };
    let destination = ensure_zip_extension(
        selected
            .into_path()
            .map_err(|_| AppError::DiagnosticsExportFailed)?,
    );

    log::logger().flush();
    let log_dir = app
        .path()
        .app_log_dir()
        .map_err(|_| AppError::DiagnosticsExportFailed)?;
    let mut metrics = serde_json::to_value(state.runtime_performance_metrics().await)
        .map_err(|_| AppError::DiagnosticsExportFailed)?;
    pseudonymize_metric_projects(&mut metrics);
    let manifest = json!({
        "appVersion": app.package_info().version.to_string(),
        "arch": std::env::consts::ARCH,
        "codexVersion": state.codex_version().await.ok(),
        "exportedAtUnixSeconds": OffsetDateTime::now_utc().unix_timestamp(),
        "os": std::env::consts::OS,
        "schemaVersion": 1,
    });

    let archive_destination = destination.clone();
    let summary = tokio::task::spawn_blocking(move || {
        write_diagnostic_archive(&archive_destination, &log_dir, &manifest, &metrics)
    })
    .await
    .map_err(|_| AppError::DiagnosticsExportFailed)?
    .map_err(|_| AppError::DiagnosticsExportFailed)?;
    diagnostics::record(
        DiagnosticLevel::Info,
        "diagnostics_exported",
        None,
        BTreeMap::from([
            ("logBytes".to_owned(), summary.log_bytes.into()),
            ("logFiles".to_owned(), summary.log_files.into()),
        ]),
    );
    let exported_name = destination
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("codexly-diagnostics.zip")
        .to_owned();
    Ok(ExportDiagnosticsResponse::Saved {
        file_name: exported_name,
    })
}

fn pseudonymize_metric_projects(metrics: &mut Value) {
    let Some(projects) = metrics.get_mut("projects").and_then(Value::as_array_mut) else {
        return;
    };
    for project in projects {
        let Some(project_id) = project.get("projectId").and_then(Value::as_str) else {
            continue;
        };
        let project_ref = diagnostics::pseudonymize_identifier("projectId", project_id);
        if let Some(project) = project.as_object_mut() {
            project.remove("projectId");
            project.insert("projectRef".to_owned(), Value::String(project_ref));
        }
    }
}

fn ensure_zip_extension(mut path: PathBuf) -> PathBuf {
    if path.extension().is_none_or(|extension| extension != "zip") {
        path.set_extension("zip");
    }
    path
}
