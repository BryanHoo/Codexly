use std::{collections::BTreeMap, path::PathBuf};

use serde::Serialize;
use serde_json::{Value, json};
use tauri::{AppHandle, Manager as _, State};
use tauri_plugin_dialog::DialogExt as _;
use time::OffsetDateTime;
use tokio::sync::oneshot;

use super::{error::AppError, state::AppState};
use crate::infrastructure::diagnostics::{
    self, DiagnosticLevel, FrontendDiagnosticInput, write_diagnostic_archive_with_codex,
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

    // 先由用户确认保存位置，再按需收集原生诊断；取消不会触发 RPC 或临时文件。
    let native_directory = tokio::task::spawn_blocking(|| {
        tempfile::Builder::new()
            .prefix("codexly-diagnostics-")
            .tempdir()
    })
    .await
    .map_err(|_| AppError::DiagnosticsExportFailed)?
    .map_err(|_| AppError::DiagnosticsExportFailed)?;
    let native_path = native_directory.path().join("codex.zip");
    let native_available = if let Ok(connection) = state.codex_connection().await {
        crate::infrastructure::codex::save_codex_diagnostics(&connection, &native_path)
            .await
            .is_ok()
    } else {
        false
    };
    let native_check_path = native_path.clone();
    let native_available = native_available
        && tokio::task::spawn_blocking(move || {
            diagnostics::validate_native_archive(&native_check_path).is_ok()
        })
        .await
        .unwrap_or(false);

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
        "codexDiagnostics": { "status": if native_available { "included" } else { "unavailable" } },
    });

    let archive_destination = destination.clone();
    let summary = tokio::task::spawn_blocking(move || {
        let result = write_diagnostic_archive_with_codex(
            &archive_destination,
            &log_dir,
            &manifest,
            &metrics,
            native_available.then_some(native_path.as_path()),
        );
        // 临时目录随阻塞任务结束释放，成功及失败均不残留原生 ZIP。
        drop(native_directory);
        result
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
