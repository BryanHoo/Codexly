use std::path::{Path, PathBuf};

use super::{
    git_protocol::{MAX_METADATA_BYTES, read_complete},
    path_guard::WorkspaceError,
};

pub(super) struct RepositorySelection {
    pub mode: &'static str,
    pub path: Option<PathBuf>,
    pub repositories: Vec<String>,
    pub repository: Option<String>,
}

/// .git 仅用于低成本候选发现，最终由 Git 解析 gitfile、linked worktree 和仓库配置。
async fn resolve_root(root: &Path) -> Result<PathBuf, WorkspaceError> {
    let output = read_complete(
        root,
        &["rev-parse", "--show-toplevel"],
        "repository",
        MAX_METADATA_BYTES,
    )
    .await?;
    let path = output.strip_suffix(b"\n").unwrap_or(&output);
    let path = std::str::from_utf8(path).map_err(|_| WorkspaceError::GitPathEncoding)?;
    let path = tokio::fs::canonicalize(path).await?;
    let expected = tokio::fs::canonicalize(root).await?;
    if path != expected {
        return Err(WorkspaceError::GitRepositoryUnavailable(
            "project folder is not the Git worktree root".to_owned(),
        ));
    }
    Ok(path)
}

pub(super) async fn select_repository(
    root: &Path,
    requested: Option<&str>,
) -> Result<RepositorySelection, WorkspaceError> {
    // 项目 Git 能力只属于当前根目录，拒绝子仓库选择，也不向父目录回溯。
    if requested.is_some() {
        return Err(WorkspaceError::InvalidPath);
    }
    if tokio::fs::try_exists(root.join(".git")).await? {
        return Ok(RepositorySelection {
            mode: "root",
            path: Some(resolve_root(root).await?),
            repositories: Vec::new(),
            repository: None,
        });
    }
    // 非 Git 项目是正常状态，不枚举目录，不启动 Git 子进程。
    Ok(RepositorySelection {
        mode: "none",
        path: None,
        repositories: Vec::new(),
        repository: None,
    })
}

pub(super) async fn repository_path(
    root: &Path,
    requested: Option<&str>,
) -> Result<PathBuf, WorkspaceError> {
    select_repository(root, requested)
        .await?
        .path
        .ok_or_else(|| {
            WorkspaceError::GitRepositoryUnavailable("select a Git repository first".to_owned())
        })
}
