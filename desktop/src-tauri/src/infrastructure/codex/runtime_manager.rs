use std::{
    env,
    ffi::OsString,
    io::{self, Write},
    path::{Component, Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::Duration,
};

use flate2::read::GzDecoder;
use serde_json::json;
use tar::Archive;
use thiserror::Error;
use tokio::{fs, task};

use super::{
    process::{
        ProcessError, SUPPORTED_CODEX_VERSION, is_compatible_codex_version, probe_codex_version,
        probe_codex_version_with_timeout,
    },
    runtime_active::read_active_codex_runtime,
    runtime_discovery::private_codex_binary_path,
    runtime_distributions::{
        DARWIN_ARM64, DARWIN_X64, LINUX_ARM64, LINUX_X64, WINDOWS_ARM64, WINDOWS_X64,
    },
    runtime_download::download_verified,
    runtime_download_progress::DownloadProgressReporter,
    runtime_path::resolve_runtime_path,
};
use crate::domain::runtime::{
    CodexRuntimeAvailability, CodexRuntimeAvailabilityStatus as AvailabilityStatus,
    CodexRuntimeInstallPhase, CodexRuntimeInstallProgress,
};

const MAX_UNPACKED_BYTES: u64 = 512 * 1024 * 1024;
static INSTALL_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Error)]
pub enum RuntimeDiscoveryError {
    #[error("compatible Codex binary was not found")]
    NotFound,
    #[error("installed Codex version is not supported")]
    Incompatible,
    #[error("failed to inspect installed Codex binaries")]
    ProbeFailed,
}

#[derive(Debug, Error)]
pub enum RuntimeInstallError {
    #[error("the current platform does not have a supported Codex package")]
    UnsupportedPlatform,
    #[error("failed to download the Codex package")]
    Download(#[from] reqwest::Error),
    #[error("the Codex package exceeds the download limit")]
    DownloadTooLarge,
    #[error("the Codex package integrity check failed")]
    Integrity,
    #[error("the Codex package archive is invalid")]
    Archive,
    #[error("failed to update the private Codex installation")]
    Filesystem(#[from] io::Error),
    #[error("the downloaded Codex binary failed validation")]
    Validation(#[source] ProcessError),
    #[error("the Codex extraction task failed")]
    ExtractionTask,
}

pub(super) struct Distribution {
    pub(super) target: &'static str,
    pub(super) url: &'static str,
    pub(super) fallback_url: &'static str,
    pub(super) integrity: &'static str,
}

struct Inspection {
    availability: CodexRuntimeAvailability,
    binary_path: Option<PathBuf>,
}

pub async fn inspect_codex_runtime(app_data: &Path) -> CodexRuntimeAvailability {
    inspect(app_data).await.availability
}

pub async fn find_compatible_codex_binary(
    app_data: &Path,
) -> Result<(PathBuf, String, Option<OsString>), RuntimeDiscoveryError> {
    let inspection = inspect(app_data).await;
    if let Some(binary_path) = inspection.binary_path {
        let version = inspection
            .availability
            .detected_version
            .ok_or(RuntimeDiscoveryError::ProbeFailed)?;
        // 仅在真正启动时恢复工具执行所需的 PATH，版本检查无需启动登录 shell。
        return Ok((binary_path, version, resolve_runtime_path().await));
    }
    match inspection.availability.status {
        AvailabilityStatus::Incompatible => Err(RuntimeDiscoveryError::Incompatible),
        AvailabilityStatus::Failed => Err(RuntimeDiscoveryError::ProbeFailed),
        AvailabilityStatus::Compatible | AvailabilityStatus::Missing => {
            Err(RuntimeDiscoveryError::NotFound)
        }
    }
}

pub async fn install_codex_runtime<OnProgress>(
    app_data: &Path,
    on_progress: OnProgress,
) -> Result<CodexRuntimeAvailability, RuntimeInstallError>
where
    OnProgress: Fn(CodexRuntimeInstallProgress) + Send + Sync,
{
    let current = inspect_codex_runtime(app_data).await;
    // 安装入口仅探测一次固定文件；版本正确时不联网、不写清单、不触发下载界面。
    if current.status == AvailabilityStatus::Compatible {
        return Ok(current);
    }
    let current_version = current.detected_version;
    let mut progress = DownloadProgressReporter::new(&on_progress, current_version);
    progress.report_phase(CodexRuntimeInstallPhase::Preparing);
    let result = install_codex_runtime_inner(app_data, &mut progress).await;
    if result.is_err() {
        progress.report_phase(CodexRuntimeInstallPhase::Failed);
    }
    result
}

async fn install_codex_runtime_inner<OnProgress>(
    app_data: &Path,
    progress: &mut DownloadProgressReporter<'_, OnProgress>,
) -> Result<CodexRuntimeAvailability, RuntimeInstallError>
where
    OnProgress: Fn(CodexRuntimeInstallProgress) + Send + Sync,
{
    let distribution = distribution_for(env::consts::OS, env::consts::ARCH)
        .ok_or(RuntimeInstallError::UnsupportedPlatform)?;
    let bin_root = app_data.join("providers/codex/bin");
    fs::create_dir_all(&bin_root).await?;

    let install_id = INSTALL_ID.fetch_add(1, Ordering::Relaxed);
    let archive_path = bin_root.join(format!(".codex-{install_id}.tgz"));
    let staging_dir = bin_root.join(format!(".{SUPPORTED_CODEX_VERSION}-{install_id}.install"));
    let final_dir = bin_root.join(SUPPORTED_CODEX_VERSION);

    let result = install_distribution(
        app_data,
        distribution,
        &archive_path,
        &staging_dir,
        &final_dir,
        progress,
    )
    .await;
    let _ = fs::remove_file(&archive_path).await;
    let _ = fs::remove_dir_all(&staging_dir).await;
    result?;

    // 暂存文件已通过版本探测，原子切换后复用验证结果，避免再次启动探测进程。
    Ok(availability(
        AvailabilityStatus::Compatible,
        Some(SUPPORTED_CODEX_VERSION.to_owned()),
    ))
}

async fn inspect(app_data: &Path) -> Inspection {
    let binary = private_codex_binary_path(app_data);
    // 固定路径是唯一执行入口；不扫描 PATH、包管理器或 active.json 中的旧路径。
    let (status, version) = match fs::symlink_metadata(&binary).await {
        Err(error) if error.kind() == io::ErrorKind::NotFound => (
            AvailabilityStatus::Missing,
            read_active_codex_runtime(app_data).map(|active| active.version),
        ),
        Err(_) => (AvailabilityStatus::Failed, None),
        Ok(_) => match probe_codex_version(&binary, None).await {
            Ok(version) if is_compatible_codex_version(&version) => {
                (AvailabilityStatus::Compatible, Some(version))
            }
            Ok(version) => (AvailabilityStatus::Incompatible, Some(version)),
            Err(_) => (AvailabilityStatus::Failed, None),
        },
    };
    Inspection {
        binary_path: (status == AvailabilityStatus::Compatible).then_some(binary),
        availability: availability(status, version),
    }
}

fn availability(
    status: AvailabilityStatus,
    detected_version: Option<String>,
) -> CodexRuntimeAvailability {
    CodexRuntimeAvailability {
        detected_version,
        required_version: SUPPORTED_CODEX_VERSION,
        status,
    }
}

pub(super) fn distribution_for(os: &str, arch: &str) -> Option<&'static Distribution> {
    match (os, arch) {
        ("macos", "aarch64") => Some(&DARWIN_ARM64),
        ("macos", "x86_64") => Some(&DARWIN_X64),
        ("linux", "aarch64") => Some(&LINUX_ARM64),
        ("linux", "x86_64") => Some(&LINUX_X64),
        ("windows", "aarch64") => Some(&WINDOWS_ARM64),
        ("windows", "x86_64") => Some(&WINDOWS_X64),
        _ => None,
    }
}

async fn install_distribution<OnProgress>(
    app_data: &Path,
    distribution: &Distribution,
    archive_path: &Path,
    staging_dir: &Path,
    final_dir: &Path,
    progress: &mut DownloadProgressReporter<'_, OnProgress>,
) -> Result<(), RuntimeInstallError>
where
    OnProgress: Fn(CodexRuntimeInstallProgress) + Send + Sync,
{
    download_verified(distribution, archive_path, progress).await?;
    progress.report_phase(CodexRuntimeInstallPhase::Installing);
    let archive = archive_path.to_owned();
    let staging = staging_dir.to_owned();
    let target = distribution.target;
    task::spawn_blocking(move || extract_distribution(&archive, &staging, target))
        .await
        .map_err(|_| RuntimeInstallError::ExtractionTask)??;

    let staged_binary = staging_dir
        .join("bin")
        .join(format!("codex{}", env::consts::EXE_SUFFIX));
    validate_staged_runtime(&staged_binary).await?;

    replace_runtime_directory(final_dir, staging_dir).await?;
    write_active_runtime(app_data, &private_codex_binary_path(app_data)).await?;
    progress.report_phase(CodexRuntimeInstallPhase::Ready);
    Ok(())
}

pub(super) async fn validate_staged_runtime(binary: &Path) -> Result<(), RuntimeInstallError> {
    // 新解包的大型签名二进制首次启动可能等待系统验证；仅安装阶段放宽预算。
    // 日常探测仍为 3 秒，输出上限与超时终止逻辑共用，不重复启动进程。
    let version = probe_codex_version_with_timeout(binary, None, Duration::from_secs(10))
        .await
        .map_err(RuntimeInstallError::Validation)?;
    if version != SUPPORTED_CODEX_VERSION {
        return Err(RuntimeInstallError::Validation(
            ProcessError::UnsupportedVersion,
        ));
    }
    Ok(())
}

fn extract_distribution(
    archive_path: &Path,
    staging_dir: &Path,
    target: &str,
) -> Result<(), RuntimeInstallError> {
    std::fs::create_dir_all(staging_dir)?;
    let file = std::fs::File::open(archive_path)?;
    let mut archive = Archive::new(GzDecoder::new(file));
    let prefix = PathBuf::from("package/vendor").join(target);
    let mut unpacked = 0_u64;

    for entry in archive
        .entries()
        .map_err(|_| RuntimeInstallError::Archive)?
    {
        let mut entry = entry.map_err(|_| RuntimeInstallError::Archive)?;
        let path = entry
            .path()
            .map_err(|_| RuntimeInstallError::Archive)?
            .into_owned();
        // 仅提取当前 target 的 vendor 子树，并拒绝所有非普通路径组件，阻止归档越界写入。
        let Ok(relative) = path.strip_prefix(&prefix) else {
            continue;
        };
        if relative.as_os_str().is_empty()
            || relative
                .components()
                .any(|component| !matches!(component, Component::Normal(_)))
        {
            return Err(RuntimeInstallError::Archive);
        }
        let destination = staging_dir.join(relative);
        if entry.header().entry_type().is_dir() {
            std::fs::create_dir_all(&destination)?;
            continue;
        }
        if !entry.header().entry_type().is_file() {
            return Err(RuntimeInstallError::Archive);
        }
        let entry_size = entry.size();
        unpacked = unpacked.saturating_add(entry_size);
        if unpacked > MAX_UNPACKED_BYTES {
            return Err(RuntimeInstallError::Archive);
        }
        if let Some(parent) = destination.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut output = std::fs::File::create(&destination)?;
        io::copy(&mut entry, &mut output)?;
        output.flush()?;
        set_archive_permissions(&destination, entry.header().mode().unwrap_or(0o644))?;
    }

    if !staging_dir.join("bin").join(executable_name()).is_file() {
        return Err(RuntimeInstallError::Archive);
    }
    Ok(())
}

#[cfg(unix)]
fn set_archive_permissions(path: &Path, mode: u32) -> Result<(), io::Error> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode & 0o777))
}

#[cfg(not(unix))]
fn set_archive_permissions(_path: &Path, _mode: u32) -> Result<(), io::Error> {
    Ok(())
}

fn executable_name() -> String {
    format!("codex{}", env::consts::EXE_SUFFIX)
}

async fn replace_runtime_directory(final_dir: &Path, staging_dir: &Path) -> Result<(), io::Error> {
    // 先保留旧目录；新目录原子切换失败时立即恢复，避免破坏已有可用版本。
    let backup = final_dir.with_extension(format!(
        "backup-{}",
        INSTALL_ID.fetch_add(1, Ordering::Relaxed)
    ));
    let had_previous = fs::try_exists(final_dir).await?;
    if had_previous {
        fs::rename(final_dir, &backup).await?;
    }
    if let Err(error) = fs::rename(staging_dir, final_dir).await {
        if had_previous {
            let _ = fs::rename(&backup, final_dir).await;
        }
        return Err(error);
    }
    if had_previous {
        let _ = fs::remove_dir_all(backup).await;
    }
    Ok(())
}

async fn write_active_runtime(app_data: &Path, binary_path: &Path) -> Result<(), io::Error> {
    let provider_root = app_data.join("providers/codex");
    let active_path = provider_root.join("active.json");
    let payload = serde_json::to_vec(&json!({
        "path": binary_path.to_string_lossy(),
        "version": SUPPORTED_CODEX_VERSION,
    }))?;
    crate::infrastructure::atomic_file::write_bytes(&active_path, payload).await
}
