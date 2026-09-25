use std::{
    fs::{self, File},
    io::{self, Write as _},
    path::{Path, PathBuf},
};

use serde_json::Value;
use thiserror::Error;
use zip::{CompressionMethod, ZipWriter, write::SimpleFileOptions};

const MAX_EXPORTED_LOG_BYTES: u64 = 30 * 1024 * 1024;
const README: &str = "Codexly diagnostics archive\n\nContains sanitized JSONL logs, runtime metrics, and version metadata.\nReview the archive before sharing it with a developer.\n";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct DiagnosticArchiveSummary {
    pub log_files: usize,
    pub log_bytes: u64,
}

#[derive(Debug, Error)]
pub enum DiagnosticExportError {
    #[error("failed to export diagnostics")]
    ExportFailed,
    #[error("diagnostic logs exceed the export size limit")]
    LogsTooLarge,
}

pub fn write_diagnostic_archive(
    destination: &Path,
    log_dir: &Path,
    manifest: &Value,
    metrics: &Value,
) -> Result<DiagnosticArchiveSummary, DiagnosticExportError> {
    let logs = collect_log_files(log_dir)?;
    let log_bytes = logs.iter().try_fold(0_u64, |total, (_, size)| {
        total
            .checked_add(*size)
            .filter(|size| *size <= MAX_EXPORTED_LOG_BYTES)
            .ok_or(DiagnosticExportError::LogsTooLarge)
    })?;
    let temporary = temporary_archive_path(destination);

    // 先写入同目录临时文件，只有完整 ZIP 成功关闭后才替换目标文件。
    let result = write_archive(&temporary, &logs, manifest, metrics).and_then(|_| {
        if destination.exists() {
            fs::remove_file(destination).map_err(|_| DiagnosticExportError::ExportFailed)?;
        }
        fs::rename(&temporary, destination).map_err(|_| DiagnosticExportError::ExportFailed)
    });
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result?;

    Ok(DiagnosticArchiveSummary {
        log_files: logs.len(),
        log_bytes,
    })
}

fn collect_log_files(log_dir: &Path) -> Result<Vec<(PathBuf, u64)>, DiagnosticExportError> {
    let mut logs = Vec::new();
    let entries = fs::read_dir(log_dir).map_err(|_| DiagnosticExportError::ExportFailed)?;
    for entry in entries {
        let entry = entry.map_err(|_| DiagnosticExportError::ExportFailed)?;
        let file_type = entry
            .file_type()
            .map_err(|_| DiagnosticExportError::ExportFailed)?;
        if !file_type.is_file() || !is_allowlisted_log(&entry.file_name()) {
            continue;
        }
        let size = entry
            .metadata()
            .map_err(|_| DiagnosticExportError::ExportFailed)?
            .len();
        logs.push((entry.path(), size));
    }
    logs.sort_by(|left, right| left.0.file_name().cmp(&right.0.file_name()));
    Ok(logs)
}

fn is_allowlisted_log(file_name: &std::ffi::OsStr) -> bool {
    let Some(file_name) = file_name.to_str() else {
        return false;
    };
    file_name.starts_with("codeagent") && file_name.ends_with(".log")
}

fn write_archive(
    temporary: &Path,
    logs: &[(PathBuf, u64)],
    manifest: &Value,
    metrics: &Value,
) -> Result<(), DiagnosticExportError> {
    let file = File::create(temporary).map_err(|_| DiagnosticExportError::ExportFailed)?;
    let mut archive = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

    write_bytes(&mut archive, "README.txt", README.as_bytes(), options)?;
    write_json(&mut archive, "manifest.json", manifest, options)?;
    write_json(&mut archive, "metrics/runtime.json", metrics, options)?;
    for (path, _) in logs {
        let file_name = path
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or(DiagnosticExportError::ExportFailed)?;
        archive
            .start_file(format!("logs/{file_name}"), options)
            .map_err(|_| DiagnosticExportError::ExportFailed)?;
        let mut source = File::open(path).map_err(|_| DiagnosticExportError::ExportFailed)?;
        io::copy(&mut source, &mut archive).map_err(|_| DiagnosticExportError::ExportFailed)?;
    }
    let output = archive
        .finish()
        .map_err(|_| DiagnosticExportError::ExportFailed)?;
    output
        .sync_all()
        .map_err(|_| DiagnosticExportError::ExportFailed)
}

fn write_json(
    archive: &mut ZipWriter<File>,
    name: &str,
    value: &Value,
    options: SimpleFileOptions,
) -> Result<(), DiagnosticExportError> {
    let bytes =
        serde_json::to_vec_pretty(value).map_err(|_| DiagnosticExportError::ExportFailed)?;
    write_bytes(archive, name, &bytes, options)
}

fn write_bytes(
    archive: &mut ZipWriter<File>,
    name: &str,
    bytes: &[u8],
    options: SimpleFileOptions,
) -> Result<(), DiagnosticExportError> {
    archive
        .start_file(name, options)
        .map_err(|_| DiagnosticExportError::ExportFailed)?;
    archive
        .write_all(bytes)
        .map_err(|_| DiagnosticExportError::ExportFailed)
}

fn temporary_archive_path(destination: &Path) -> PathBuf {
    let file_name = destination
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("codexly-diagnostics.zip");
    destination.with_file_name(format!(".{file_name}.{}.partial", std::process::id()))
}
