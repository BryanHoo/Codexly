use super::codex::{
    runtime_download::download_dependency, runtime_download_progress::DownloadProgressReporter,
};
use crate::domain::runtime::{
    CodexRuntimeInstallPhase as Phase, CodexRuntimeInstallProgress as Progress,
};
use serde::Deserialize;
use std::{
    path::{Path, PathBuf},
    sync::LazyLock,
};
use tokio::sync::Mutex;

mod contract {
    include!(concat!(env!("OUT_DIR"), "/claude_distribution.rs"));
}
#[path = "claude_runtime_files.rs"]
mod files;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Dependency {
    version: String,
    url: String,
    fallback_url: Option<String>,
    integrity: String,
    sha256: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    schema_version: u8,
    sdk_version: &'static str,
    platform: String,
    arch: String,
    native: Dependency,
    host: Dependency,
}
static MANIFEST: LazyLock<Result<Manifest, String>> =
    LazyLock::new(|| serde_json::from_str(contract::MANIFEST).map_err(|error| error.to_string()));

pub(crate) type RuntimePaths = (PathBuf, PathBuf);
#[derive(Default)]
pub(crate) struct ClaudeRuntimeManager {
    // 同一应用中的设置、启动检查与聊天请求合并安装，失败后允许下一次请求重试。
    prepared: Mutex<Option<RuntimePaths>>,
}
impl ClaudeRuntimeManager {
    pub(crate) async fn prepare<F>(
        &self,
        app_data: &Path,
        on_progress: F,
    ) -> Result<RuntimePaths, String>
    where
        F: Fn(Progress) + Send + Sync,
    {
        let mut prepared = self.prepared.lock().await;
        if let Some(paths) = prepared.as_ref() {
            return Ok(paths.clone());
        }
        let manifest = MANIFEST.as_ref().map_err(Clone::clone)?;
        manifest.validate()?;
        let mut progress =
            DownloadProgressReporter::for_version(&on_progress, None, manifest.sdk_version);
        progress.report_phase(Phase::Preparing);
        let result = prepare_dependencies(app_data, manifest, &mut progress).await;
        match result {
            Ok(paths) => {
                progress.report_phase(Phase::Ready);
                *prepared = Some(paths.clone());
                Ok(paths)
            }
            Err(error) => {
                progress.report_phase(Phase::Failed);
                Err(error)
            }
        }
    }
}
impl Manifest {
    fn validate(&self) -> Result<(), String> {
        let platform = match std::env::consts::OS {
            "macos" => "darwin",
            "windows" => "win32",
            other => other,
        };
        let arch = match std::env::consts::ARCH {
            "aarch64" => "arm64",
            "x86_64" => "x64",
            other => other,
        };
        if self.schema_version != 1
            || self.platform != platform
            || self.arch != arch
            || self.sdk_version != self.native.version
        {
            return Err(
                "Incompatible Claude runtime distribution; rebuild for this platform".into(),
            );
        }
        for dependency in [&self.native, &self.host] {
            if dependency.sha256.len() != 64
                || !dependency
                    .sha256
                    .bytes()
                    .all(|byte| byte.is_ascii_hexdigit())
            {
                return Err("Invalid Claude dependency digest".into());
            }
        }
        Ok(())
    }
}
async fn prepare_dependencies<F>(
    app_data: &Path,
    manifest: &Manifest,
    progress: &mut DownloadProgressReporter<'_, F>,
) -> Result<RuntimePaths, String>
where
    F: Fn(Progress) + Send + Sync,
{
    let root = app_data.join("providers/claude");
    // 原生程序与适配宿主独立按摘要寻址，应用升级只获取实际变化的依赖。
    let binary = install(&root, &manifest.native, false, progress).await?;
    let host = install(&root, &manifest.host, true, progress).await?;
    Ok((binary, host))
}
async fn install<F>(
    root: &Path,
    dependency: &Dependency,
    host: bool,
    progress: &mut DownloadProgressReporter<'_, F>,
) -> Result<PathBuf, String>
where
    F: Fn(Progress) + Send + Sync,
{
    let name = if host { "claude-host" } else { "claude" };
    let name = format!("{name}{}", std::env::consts::EXE_SUFFIX);
    let directory = root
        .join(if host { "hosts" } else { "native" })
        .join(&dependency.sha256);
    let target = directory.join(&name);
    let check_path = target.clone();
    let digest = dependency.sha256.clone();
    if tokio::task::spawn_blocking(move || files::verified(&check_path, &digest))
        .await
        .map_err(|e| e.to_string())?
    {
        return Ok(target);
    }
    if !host {
        let legacy_root = root.join(&dependency.version);
        let legacy_name = name.clone();
        let digest = dependency.sha256.clone();
        if let Some(legacy) = tokio::task::spawn_blocking(move || {
            files::legacy_binary(&legacy_root, &legacy_name, &digest)
        })
        .await
        .map_err(|e| e.to_string())?
        {
            return Ok(legacy);
        }
    }
    tokio::fs::create_dir_all(&directory)
        .await
        .map_err(|e| e.to_string())?;
    // 本地调试没有已发布的宿主附件，仅 debug 构建允许复用本次构建的校验资源。
    #[cfg(debug_assertions)]
    {
        let source = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("resources/claude")
            .join(&name);
        let destination = target.clone();
        let digest = dependency.sha256.clone();
        let imported = tokio::task::spawn_blocking(move || -> Result<bool, String> {
            if !files::verified(&source, &digest) {
                return Ok(false);
            }
            let mut file = std::fs::File::open(source).map_err(|e| e.to_string())?;
            files::publish(&mut file, &destination, &digest)?;
            Ok(true)
        })
        .await
        .map_err(|e| e.to_string())??;
        if imported {
            return Ok(target);
        }
    }
    // 临时文件独立命名；失败与取消只清理本次下载，绝不覆盖旧版本或半写入成品。
    let archive = tempfile::NamedTempFile::new_in(&directory).map_err(|e| e.to_string())?;
    download_dependency(
        [
            &dependency.url,
            dependency
                .fallback_url
                .as_deref()
                .unwrap_or(&dependency.url),
        ],
        host,
        &dependency.integrity,
        archive.path(),
        progress,
    )
    .await
    .map_err(|e| format!("Claude dependency download failed: {e}"))?;
    progress.report_phase(Phase::Installing);
    let destination = target.clone();
    let digest = dependency.sha256.clone();
    tokio::task::spawn_blocking(move || {
        files::extract(archive.path(), &destination, &digest, host)
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(target)
}

#[cfg(test)]
#[path = "claude_runtime_tests.rs"]
mod tests;
