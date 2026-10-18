use super::{
    process::{SUPPORTED_CODEX_VERSION, is_compatible_codex_version, probe_codex_version},
    runtime_path::resolve_runtime_path,
};
use crate::domain::runtime::{
    CodexRuntimeAvailability, CodexRuntimeAvailabilityStatus as Status, CodexRuntimeInstallProgress,
};
use std::{
    ffi::OsString,
    io,
    path::{Path, PathBuf},
};
use thiserror::Error;
use tokio::fs;

#[derive(Debug, Error)]
pub enum RuntimeDiscoveryError {
    #[error("bundled Codex binary was not found; reinstall the application")]
    NotFound,
    #[error("bundled Codex version is not supported; reinstall the application")]
    Incompatible,
    #[error("failed to inspect bundled Codex binary")]
    ProbeFailed,
}

pub(super) fn bundled_codex_binary_path(resources: &Path) -> PathBuf {
    resources
        .join("codex/bin")
        .join(format!("codex{}", std::env::consts::EXE_SUFFIX))
}

/// 只检查安装目录中的固定文件，缺失时立即返回错误，禁止下载或信任旧用户目录的程序。
pub async fn inspect_codex_runtime(resources: &Path) -> CodexRuntimeAvailability {
    let binary = bundled_codex_binary_path(resources);
    let (status, detected_version) = match fs::symlink_metadata(&binary).await {
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            // Windows 对父路径为文件也返回 NotFound，不能将损坏的资源根目录报告为缺失。
            let status = match fs::metadata(resources).await {
                Ok(metadata) if !metadata.is_dir() => Status::Failed,
                Err(error) if error.kind() != io::ErrorKind::NotFound => Status::Failed,
                _ => Status::Missing,
            };
            (status, None)
        }
        Err(_) => (Status::Failed, None),
        Ok(metadata) if !metadata.is_file() => (Status::Failed, None),
        Ok(_) => match probe_codex_version(&binary, None).await {
            Ok(version) if is_compatible_codex_version(&version) => {
                (Status::Compatible, Some(version))
            }
            Ok(version) => (Status::Incompatible, Some(version)),
            Err(_) => (Status::Failed, None),
        },
    };
    CodexRuntimeAvailability {
        detected_version,
        required_version: SUPPORTED_CODEX_VERSION,
        status,
    }
}

pub async fn find_compatible_codex_binary(
    resources: &Path,
) -> Result<(PathBuf, String, Option<OsString>), RuntimeDiscoveryError> {
    let availability = inspect_codex_runtime(resources).await;
    match availability.status {
        Status::Compatible => Ok((
            bundled_codex_binary_path(resources),
            availability
                .detected_version
                .ok_or(RuntimeDiscoveryError::ProbeFailed)?,
            resolve_runtime_path().await,
        )),
        Status::Missing => Err(RuntimeDiscoveryError::NotFound),
        Status::Incompatible => Err(RuntimeDiscoveryError::Incompatible),
        Status::Failed => Err(RuntimeDiscoveryError::ProbeFailed),
    }
}

/// 保留 IPC 兼容入口，但安装已由系统安装器负责，此处只做离线检查。
pub async fn install_codex_runtime<F>(
    resources: &Path,
    _on_progress: F,
) -> Result<CodexRuntimeAvailability, RuntimeDiscoveryError>
where
    F: Fn(CodexRuntimeInstallProgress) + Send + Sync,
{
    let result = inspect_codex_runtime(resources).await;
    match result.status {
        Status::Compatible => Ok(result),
        Status::Missing => Err(RuntimeDiscoveryError::NotFound),
        Status::Incompatible => Err(RuntimeDiscoveryError::Incompatible),
        Status::Failed => Err(RuntimeDiscoveryError::ProbeFailed),
    }
}
