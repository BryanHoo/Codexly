use crate::application::error::AppError;
use std::path::PathBuf;
use tauri::AppHandle;
#[cfg(not(debug_assertions))]
use tauri::Manager;

/// 安装资源只读直用；开发模式使用同一构建产物，绝不回退到用户目录或 PATH。
pub(crate) fn root(app: &AppHandle) -> Result<PathBuf, AppError> {
    #[cfg(debug_assertions)]
    {
        let _ = app;
        Ok(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/runtime"))
    }
    #[cfg(not(debug_assertions))]
    {
        app.path()
            .resource_dir()
            .map(|path| path.join("runtime"))
            .map_err(|_| AppError::FilesystemRequestFailed)
    }
}

/// Tauri 将 sidecar 安装在主程序旁；开发时由 tauri-build 复制到相同位置。
pub(crate) fn claude_host() -> Result<PathBuf, AppError> {
    let executable = std::env::current_exe().map_err(|_| AppError::FilesystemRequestFailed)?;
    let directory = executable
        .parent()
        .ok_or(AppError::FilesystemRequestFailed)?;
    Ok(directory.join(format!("claude-host{}", std::env::consts::EXE_SUFFIX)))
}
