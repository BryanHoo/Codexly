use std::path::{Path, PathBuf};

use super::{
    git_protocol::{MAX_METADATA_BYTES, read_complete},
    path_guard::{WorkspaceError, valid_relative},
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
    if tokio::fs::try_exists(root.join(".git")).await? {
        if requested.is_some() {
            return Err(WorkspaceError::InvalidPath);
        }
        return Ok(RepositorySelection {
            mode: "root",
            path: Some(resolve_root(root).await?),
            repositories: Vec::new(),
            repository: None,
        });
    }
    let mut repositories = Vec::new();
    let mut reader = tokio::fs::read_dir(root).await?;
    while let Some(entry) = reader.next_entry().await? {
        if entry.file_type().await?.is_dir()
            && tokio::fs::try_exists(entry.path().join(".git")).await?
        {
            repositories.push(
                entry
                    .file_name()
                    .into_string()
                    .map_err(|_| WorkspaceError::GitPathEncoding)?,
            );
            if repositories.len() > 256 {
                return Err(WorkspaceError::GitOutputTooLarge {
                    operation: "repository discovery",
                    maximum_bytes: MAX_METADATA_BYTES,
                });
            }
        }
    }
    repositories.sort_unstable();
    let path = match requested {
        Some(value) if repositories.iter().any(|name| name == value) => {
            Some(resolve_root(&root.join(valid_relative(value)?)).await?)
        }
        Some(_) => {
            return Err(WorkspaceError::GitRepositoryUnavailable(
                "selected Git repository is no longer available".to_owned(),
            ));
        }
        None => None,
    };
    Ok(RepositorySelection {
        mode: if repositories.is_empty() {
            "none"
        } else {
            "children"
        },
        path,
        repositories,
        repository: requested.map(str::to_owned),
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
