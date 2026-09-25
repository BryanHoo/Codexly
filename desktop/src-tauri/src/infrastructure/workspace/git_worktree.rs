use std::path::{Path, PathBuf};

use serde::Serialize;

use super::{
    git_process::{git_path_argument, run_git},
    git_read::repository_path,
    git_write::{validate_branch, validate_snapshot},
    path_guard::WorkspaceError,
};

const MAX_GIT_OUTPUT_BYTES: usize = 2 * 1024 * 1024;
const MAX_WORKTREES: usize = 256;

#[derive(Debug, Serialize)]
pub struct WorktreePage {
    pub worktrees: Vec<Worktree>,
}

#[derive(Clone, Debug, Serialize)]
pub struct Worktree {
    pub branch: Option<String>,
    pub current: bool,
    pub path: String,
}

pub async fn list_worktrees(
    root: &Path,
    repository: Option<&str>,
) -> Result<WorktreePage, WorkspaceError> {
    let repo = repository_path(root, repository).await?;
    let output = super::git_protocol::read_complete(
        &repo,
        &["worktree", "list", "--porcelain", "-z"],
        "worktrees",
        MAX_GIT_OUTPUT_BYTES,
    )
    .await?;
    let current = tokio::fs::canonicalize(&repo).await?;
    let mut worktrees = Vec::new();
    let mut fields = Vec::new();
    // `-z` 使用空 NUL 字段分隔记录，路径中的换行因此不会破坏字段边界。
    for field in output.split(|byte| *byte == 0) {
        if field.is_empty() {
            append_worktree(&mut worktrees, &fields, &current).await?;
            fields.clear();
        } else {
            fields.push(field);
        }
    }
    if !fields.is_empty() {
        append_worktree(&mut worktrees, &fields, &current).await?;
    }
    Ok(WorktreePage { worktrees })
}

pub async fn create_worktree(
    root: &Path,
    repository: Option<&str>,
    branch: &str,
    expected_snapshot: &str,
) -> Result<Worktree, WorkspaceError> {
    let status = validate_snapshot(root, repository, expected_snapshot).await?;
    validate_branch(root, repository, branch).await?;
    let repo = repository_path(root, repository).await?;
    let target = available_worktree_path(&repo, branch).await?;
    let target_string = git_path_argument(&target);
    let args = if status.branches.iter().any(|value| value == branch) {
        vec!["worktree", "add", "--", target_string.as_str(), branch]
    } else {
        vec![
            "worktree",
            "add",
            "-b",
            branch,
            "--",
            target_string.as_str(),
            "HEAD",
        ]
    };
    run_git(&repo, &args, MAX_GIT_OUTPUT_BYTES).await?;
    let canonical = tokio::fs::canonicalize(target).await?;
    Ok(Worktree {
        branch: Some(branch.to_owned()),
        current: false,
        path: canonical.to_string_lossy().into_owned(),
    })
}

pub async fn switch_worktree(
    root: &Path,
    repository: Option<&str>,
    path: &str,
) -> Result<Worktree, WorkspaceError> {
    let requested = tokio::fs::canonicalize(path).await?;
    list_worktrees(root, repository)
        .await?
        .worktrees
        .into_iter()
        .find(|worktree| Path::new(&worktree.path) == requested && !worktree.current)
        .ok_or(WorkspaceError::InvalidPath)
}

async fn append_worktree(
    worktrees: &mut Vec<Worktree>,
    fields: &[&[u8]],
    current: &Path,
) -> Result<(), WorkspaceError> {
    let path = fields
        .iter()
        .find_map(|field| field.strip_prefix(b"worktree "));
    let Some(path) = path else { return Ok(()) };
    if worktrees.len() >= MAX_WORKTREES {
        return Err(WorkspaceError::InvalidPath);
    }
    let path = std::str::from_utf8(path).map_err(|_| WorkspaceError::InvalidPath)?;
    let branch = fields
        .iter()
        .find_map(|field| field.strip_prefix(b"branch refs/heads/"))
        .map(|value| {
            std::str::from_utf8(value)
                .map(str::to_owned)
                .map_err(|_| WorkspaceError::InvalidPath)
        })
        .transpose()?;
    let canonical = tokio::fs::canonicalize(path).await?;
    worktrees.push(Worktree {
        branch,
        current: canonical == current,
        path: canonical.to_string_lossy().into_owned(),
    });
    Ok(())
}

async fn available_worktree_path(repo: &Path, branch: &str) -> Result<PathBuf, WorkspaceError> {
    let parent = repo.parent().ok_or(WorkspaceError::InvalidPath)?;
    let base = repo
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or(WorkspaceError::InvalidPath)?;
    let base_path = parent.join(format!("{base}-{}", worktree_slug(branch)));
    let base_name = base_path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or(WorkspaceError::InvalidPath)?;
    // 最多探测 256 个稳定候选，既处理常见冲突，也限制文件系统调用次数。
    for suffix in 1..=MAX_WORKTREES {
        let candidate = if suffix == 1 {
            base_path.clone()
        } else {
            base_path.with_file_name(format!("{base_name}-{suffix}"))
        };
        if !tokio::fs::try_exists(&candidate).await? {
            return Ok(candidate);
        }
    }
    Err(WorkspaceError::InvalidPath)
}

fn worktree_slug(branch: &str) -> String {
    let mut slug = String::with_capacity(branch.len());
    let mut replacing = false;
    for character in branch.chars() {
        if character.is_alphanumeric() || matches!(character, '.' | '_' | '-') {
            slug.push(character);
            replacing = false;
        } else if !replacing {
            slug.push('-');
            replacing = true;
        }
    }
    let slug = slug.trim_matches(['.', '-']);
    if slug.is_empty() {
        "worktree".to_owned()
    } else {
        slug.to_owned()
    }
}
