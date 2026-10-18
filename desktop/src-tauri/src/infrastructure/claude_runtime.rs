use crate::domain::runtime::CodexRuntimeInstallProgress;
use std::path::{Path, PathBuf};
use tokio::sync::Mutex;

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
