use crate::domain::runtime::CodexRuntimeInstallProgress;
use std::path::{Path, PathBuf};
use tokio::{io::AsyncReadExt, sync::Mutex};

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClaudeVersionManifest {
    claude_code_version: String,
}

/// 关于页仅异步读取小清单；旧安装包或 legacy macOS 缺少资源时正常降级。
pub(crate) async fn bundled_claude_version(resources: &Path) -> Option<String> {
    // 不调用 prepare、不启动 Claude，也不读取或哈希大型二进制；损坏清单同样限制读取量。
    const MAX_MANIFEST_BYTES: u64 = 16 * 1024;
    let file = tokio::fs::File::open(resources.join("claude/manifest.json"))
        .await
        .ok()?;
    let mut bytes = Vec::new();
    file.take(MAX_MANIFEST_BYTES + 1)
        .read_to_end(&mut bytes)
        .await
        .ok()?;
    if bytes.len() as u64 > MAX_MANIFEST_BYTES {
        return None;
    }
    let manifest: ClaudeVersionManifest = serde_json::from_slice(&bytes).ok()?;
    // 只接受完整的严格语义版本，不把 SDK 的 0.3.x 版本误作 CLI 版本回退。
    semver::Version::parse(&manifest.claude_code_version).ok()?;
    Some(manifest.claude_code_version)
}

pub(crate) type RuntimePaths = (PathBuf, PathBuf);
#[derive(Default)]
pub(crate) struct ClaudeRuntimeManager {
    // 同一应用进程只解析一次资源；不重复扫描或哈希数百 MB 的已签名二进制。
    prepared: Mutex<Option<RuntimePaths>>,
}
impl ClaudeRuntimeManager {
    pub(crate) async fn prepare<F>(
        &self,
        resources: &Path,
        host: PathBuf,
        _on_progress: F,
    ) -> Result<RuntimePaths, String>
    where
        F: Fn(CodexRuntimeInstallProgress) + Send + Sync,
    {
        let mut prepared = self.prepared.lock().await;
        if let Some(paths) = prepared.as_ref() {
            return Ok(paths.clone());
        }
        let directory = resources.join("claude");
        let binary = directory.join(format!("claude{}", std::env::consts::EXE_SUFFIX));
        // 摘要在构建阶段校验，运行时依赖安装包签名；重新签名会改变 Mach-O 摘要。
        for path in [&binary, &host] {
            let metadata = tokio::fs::symlink_metadata(path)
                .await
                .map_err(|_| "Bundled Claude runtime is missing; reinstall the application")?;
            if !metadata.is_file() || metadata.len() == 0 {
                return Err("Bundled Claude runtime is invalid; reinstall the application".into());
            }
        }
        let paths = (binary, host);
        *prepared = Some(paths.clone());
        Ok(paths)
    }
}
#[cfg(test)]
#[path = "claude_runtime_tests.rs"]
mod tests;
