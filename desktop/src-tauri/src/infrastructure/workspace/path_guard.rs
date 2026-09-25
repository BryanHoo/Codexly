use std::path::{Component, Path, PathBuf};

use thiserror::Error;

#[derive(Debug, Error)]
pub enum WorkspaceError {
    #[error("invalid workspace path")]
    InvalidPath,
    #[error("git {operation} returned invalid data: {detail}")]
    GitOutputInvalid {
        operation: &'static str,
        detail: &'static str,
    },
    #[error("git {operation} output exceeded {maximum_bytes} bytes")]
    GitOutputTooLarge {
        operation: &'static str,
        maximum_bytes: usize,
    },
    #[error("Git path cannot be represented as UTF-8")]
    GitPathEncoding,
    #[error("{0}")]
    GitRepositoryUnavailable(String),
    #[error("attachment exceeds the {maximum_bytes} byte limit")]
    AttachmentTooLarge { maximum_bytes: usize },
    #[error("workspace snapshot changed; refresh and retry")]
    SnapshotMismatch,
    #[error("invalid Git branch name")]
    InvalidBranch,
    #[error("current branch has no upstream")]
    NoUpstream,
    #[error("Git was not found; install Git and restart Codexly")]
    GitNotFound,
    #[error("{0}")]
    GitLocalChangesOverwritten(String),
    #[error("{0}")]
    GitCommandFailed(String),
    #[error("workspace I/O failed: {0}")]
    Io(#[from] std::io::Error),
}

impl WorkspaceError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::InvalidPath => "INVALID_PATH",
            Self::GitOutputInvalid { .. } => "GIT_OUTPUT_INVALID",
            Self::GitOutputTooLarge { .. } => "GIT_OUTPUT_TOO_LARGE",
            Self::GitPathEncoding => "GIT_PATH_ENCODING_UNSUPPORTED",
            Self::GitRepositoryUnavailable(_) => "GIT_REPOSITORY_UNAVAILABLE",
            Self::AttachmentTooLarge { .. } => "ATTACHMENT_TOO_LARGE",
            Self::SnapshotMismatch => "SNAPSHOT_MISMATCH",
            Self::InvalidBranch => "INVALID_BRANCH",
            Self::NoUpstream => "NO_UPSTREAM",
            Self::GitNotFound => "GIT_NOT_FOUND",
            Self::GitLocalChangesOverwritten(_) => "GIT_LOCAL_CHANGES_OVERWRITTEN",
            Self::GitCommandFailed(_) => "GIT_COMMAND_FAILED",
            Self::Io(_) => "IO_FAILED",
        }
    }
}

pub async fn canonical_root(path: &str) -> Result<PathBuf, WorkspaceError> {
    let root = tokio::fs::canonicalize(path).await?;
    if !tokio::fs::metadata(&root).await?.is_dir() {
        return Err(WorkspaceError::InvalidPath);
    }
    Ok(root)
}

pub async fn resolve_existing(
    root: &Path,
    relative: Option<&str>,
) -> Result<PathBuf, WorkspaceError> {
    let candidate = match relative {
        // 文件访问使用本机路径语义，绝对路径和父目录跳转不受项目边界限制。
        Some(relative) => root.join(relative),
        None => root.to_path_buf(),
    };
    Ok(tokio::fs::canonicalize(candidate).await?)
}

pub async fn resolve_destination(root: &Path, relative: &Path) -> Result<PathBuf, WorkspaceError> {
    let candidate = root.join(relative);
    let parent = candidate.parent().ok_or(WorkspaceError::InvalidPath)?;
    let resolved_parent = tokio::fs::canonicalize(parent).await?;
    let name = candidate.file_name().ok_or(WorkspaceError::InvalidPath)?;
    Ok(resolved_parent.join(name))
}

pub fn valid_relative(value: &str) -> Result<PathBuf, WorkspaceError> {
    let path = Path::new(value);
    if value.is_empty()
        || value.contains('\0')
        || path.is_absolute()
        || (cfg!(windows) && value.contains('\\'))
    {
        return Err(WorkspaceError::InvalidPath);
    }
    normalize_relative(path)
}

fn normalize_relative(path: &Path) -> Result<PathBuf, WorkspaceError> {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        let Component::Normal(component) = component else {
            return Err(WorkspaceError::InvalidPath);
        };
        normalized.push(component);
    }
    (!normalized.as_os_str().is_empty())
        .then_some(normalized)
        .ok_or(WorkspaceError::InvalidPath)
}

pub fn relative_string(root: &Path, path: &Path) -> Result<String, WorkspaceError> {
    // 项目内继续返回相对路径，项目外保留绝对路径，避免调用方再次拼错位置。
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_str()
        .filter(|value| !value.is_empty())
        .map(|value| value.replace(std::path::MAIN_SEPARATOR, "/"))
        .ok_or(WorkspaceError::InvalidPath)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relative_protocol_paths_should_use_native_components() {
        assert_eq!(
            valid_relative("src/main.rs").unwrap(),
            PathBuf::from("src").join("main.rs")
        );
    }
}
