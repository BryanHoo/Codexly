use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

use serde::Serialize;

use super::{
    git_process::{run_git, run_git_with_index, run_network_git},
    git_read::{GitStatus, repository_path},
    path_guard::{WorkspaceError, valid_relative},
};

const MAX_GIT_OUTPUT_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug)]
pub struct CommitMessageContext {
    pub changes: String,
    pub snapshot: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitChangesResponse {
    pub branch: Option<String>,
    pub commit_sha: String,
    pub message: String,
    pub index_sync_error: Option<&'static str>,
    pub push_error: Option<String>,
    pub push_status: &'static str,
}

pub async fn switch_branch(
    root: &Path,
    repository: Option<&str>,
    branch: &str,
    expected_snapshot: &str,
) -> Result<GitStatus, WorkspaceError> {
    validate_snapshot(root, repository, expected_snapshot).await?;
    validate_branch(root, repository, branch).await?;
    let repo = repository_path(root, repository).await?;
    run_git(&repo, &["switch", "--", branch], MAX_GIT_OUTPUT_BYTES).await?;
    super::git_status_page::get_git_status_page(root, repository, None).await
}

pub async fn create_branch(
    root: &Path,
    repository: Option<&str>,
    branch: &str,
    expected_snapshot: &str,
) -> Result<GitStatus, WorkspaceError> {
    validate_snapshot(root, repository, expected_snapshot).await?;
    validate_branch(root, repository, branch).await?;
    let repo = repository_path(root, repository).await?;
    run_git(&repo, &["switch", "-c", branch], MAX_GIT_OUTPUT_BYTES).await?;
    super::git_status_page::get_git_status_page(root, repository, None).await
}

pub async fn commit_changes(
    root: &Path,
    repository: Option<&str>,
    paths: &[String],
    message: &str,
    action: &str,
    expected_snapshot: &str,
) -> Result<CommitChangesResponse, WorkspaceError> {
    validate_paths(paths)?;
    if message.trim().is_empty() || message.len() > 10_000 {
        return Err(WorkspaceError::InvalidPath);
    }
    if !matches!(action, "commit" | "commit_and_push") {
        return Err(WorkspaceError::InvalidPath);
    }
    let status = validate_snapshot(root, repository, expected_snapshot).await?;
    let repo = repository_path(root, repository).await?;
    let staged_paths: HashSet<_> = status
        .staged
        .iter()
        .map(|change| change.path.as_str())
        .collect();
    let selected: HashSet<_> = paths.iter().map(String::as_str).collect();
    let mut selected_staged: Vec<_> = paths
        .iter()
        .filter(|path| staged_paths.contains(path.as_str()))
        .collect();
    let selected_unstaged: Vec<_> = paths
        .iter()
        .filter(|path| !staged_paths.contains(path.as_str()))
        .collect();
    let mut copied_paths: HashSet<_> = selected_staged.iter().map(|path| path.as_str()).collect();
    // 重命名是一项变更，隔离 index 和真实 index 必须同时处理旧路径删除与新路径写入。
    for change in &status.staged {
        if selected.contains(change.path.as_str())
            && let Some(original) = &change.original_path
            && copied_paths.insert(original.as_str())
        {
            selected_staged.push(original);
        }
    }
    let reset_input = super::git_index_selection::path_input(
        selected_staged
            .iter()
            .chain(&selected_unstaged)
            .map(|path| path.as_str()),
    );
    let head = super::git_read::head_commit(&repo).await?;
    let (temporary_root, temporary_index) = create_temporary_index().await?;
    let commit_result = async {
        // 从 HEAD 组装隔离 index，禁止未选择的暂存条目进入本次提交。
        run_git_with_index(
            &repo,
            &["read-tree", head.as_deref().unwrap_or("--empty")],
            MAX_GIT_OUTPUT_BYTES,
            &temporary_index,
            None,
        )
        .await?;
        if !selected_staged.is_empty() {
            super::git_index_selection::copy_staged(&repo, &temporary_index, &selected_staged)
                .await?;
        }
        if !selected_unstaged.is_empty() {
            let input = super::git_index_selection::path_input(
                selected_unstaged.iter().map(|path| path.as_str()),
            );
            run_git_with_index(
                &repo,
                &["add", "--pathspec-from-file=-", "--pathspec-file-nul"],
                MAX_GIT_OUTPUT_BYTES,
                &temporary_index,
                Some(&input),
            )
            .await?;
        }
        // 隔离 index 构建期间内容仍可能变化，提交前再次拒绝过期预览。
        validate_snapshot(root, repository, expected_snapshot).await?;
        // 大提交不打印逐文件摘要，避免成功提交后的日志洪水耗尽进程输出预算。
        run_git_with_index(
            &repo,
            &["commit", "--quiet", "--no-gpg-sign", "-m", message],
            MAX_GIT_OUTPUT_BYTES,
            &temporary_index,
            None,
        )
        .await?;
        Ok::<_, WorkspaceError>(())
    }
    .await;
    // 清理失败不能覆盖已完成的 commit 结果。
    let _ = tokio::fs::remove_dir_all(&temporary_root).await;
    commit_result?;

    let commit_sha = first_line(&repo, &["rev-parse", "HEAD"]).await?;
    let branch = status.branch;
    // HEAD 已更新，收尾失败不能把成功提交降格为可重试的整体错误。
    let index_sync_error = super::git_process::run_git_with_input(
        &repo,
        &[
            "reset",
            "--quiet",
            "--pathspec-from-file=-",
            "--pathspec-file-nul",
            "HEAD",
        ],
        MAX_GIT_OUTPUT_BYTES,
        &reset_input,
    )
    .await
    .err()
    .map(|_| "GIT_INDEX_SYNC_FAILED");
    let (push_status, push_error) = if action == "commit" {
        ("not_requested", None)
    } else {
        match remote_names(&repo).await {
            Err(error) => ("failed", Some(error.to_string())),
            Ok(remotes) if remotes.is_empty() => (
                "not_configured",
                Some(WorkspaceError::NoUpstream.to_string()),
            ),
            Ok(remotes) => push_current_branch(&repo, branch.as_deref(), &remotes).await,
        }
    };
    Ok(CommitChangesResponse {
        branch,
        commit_sha,
        index_sync_error,
        message: message.to_owned(),
        push_error,
        push_status,
    })
}

async fn push_current_branch(
    repo: &Path,
    branch: Option<&str>,
    remotes: &[String],
) -> (&'static str, Option<String>) {
    match run_network_git(repo, &["push"], MAX_GIT_OUTPUT_BYTES).await {
        Ok(_) => ("pushed", None),
        Err(WorkspaceError::NoUpstream) => {
            let remote = remotes
                .iter()
                .find(|remote| remote.as_str() == "origin")
                .or_else(|| (remotes.len() == 1).then(|| &remotes[0]));
            let (Some(branch), Some(remote)) = (branch, remote) else {
                return (
                    "not_configured",
                    Some(WorkspaceError::NoUpstream.to_string()),
                );
            };
            // 新建分支首次推送时一次性建立 upstream，后续继续走普通 push。
            match run_network_git(
                repo,
                &["push", "--set-upstream", remote, branch],
                MAX_GIT_OUTPUT_BYTES,
            )
            .await
            {
                Ok(_) => ("pushed", None),
                Err(error) => ("failed", Some(error.to_string())),
            }
        }
        Err(error) => ("failed", Some(error.to_string())),
    }
}

async fn remote_names(repo: &Path) -> Result<Vec<String>, WorkspaceError> {
    let output = run_git(repo, &["remote"], MAX_GIT_OUTPUT_BYTES).await?.0;
    Ok(String::from_utf8(output)
        .map_err(|_| WorkspaceError::InvalidPath)?
        .lines()
        .map(str::trim)
        .filter(|remote| !remote.is_empty())
        .map(str::to_owned)
        .collect())
}

async fn create_temporary_index() -> Result<(PathBuf, PathBuf), WorkspaceError> {
    static NEXT_INDEX: AtomicU64 = AtomicU64::new(0);
    for _ in 0..16 {
        let sequence = NEXT_INDEX.fetch_add(1, Ordering::Relaxed);
        let root = std::env::temp_dir().join(format!(
            "codeagent-git-index-{}-{sequence}",
            std::process::id()
        ));
        match tokio::fs::create_dir(&root).await {
            Ok(()) => {
                let index = root.join("index");
                return Ok((root, index));
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.into()),
        }
    }
    Err(std::io::Error::new(
        std::io::ErrorKind::AlreadyExists,
        "temporary Git index path is unavailable",
    )
    .into())
}

pub(super) async fn validate_snapshot(
    root: &Path,
    repository: Option<&str>,
    expected: &str,
) -> Result<GitStatus, WorkspaceError> {
    if expected.len() != 64 || !expected.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(WorkspaceError::InvalidPath);
    }
    let status = super::git_read::read_git_status(root, repository, false, true).await?;
    if status.snapshot != expected {
        return Err(WorkspaceError::SnapshotMismatch);
    }
    Ok(status)
}

pub(super) async fn validate_branch(
    root: &Path,
    repository: Option<&str>,
    branch: &str,
) -> Result<(), WorkspaceError> {
    if branch.trim() != branch || branch.is_empty() || branch.len() > 1_024 {
        return Err(WorkspaceError::InvalidBranch);
    }
    let repo = repository_path(root, repository).await?;
    if run_git(
        &repo,
        &["check-ref-format", "--branch", branch],
        MAX_GIT_OUTPUT_BYTES,
    )
    .await
    .is_err()
    {
        return Err(WorkspaceError::InvalidBranch);
    }
    Ok(())
}

pub(super) fn validate_paths(paths: &[String]) -> Result<(), WorkspaceError> {
    if paths.is_empty() || paths.iter().map(String::len).sum::<usize>() > 32 * 1024 * 1024 {
        return Err(WorkspaceError::InvalidPath);
    }
    for path in paths {
        valid_relative(path)?;
    }
    Ok(())
}

async fn first_line(repo: &Path, args: &[&str]) -> Result<String, WorkspaceError> {
    optional_line(repo, args)
        .await?
        .ok_or(WorkspaceError::InvalidPath)
}

async fn optional_line(repo: &Path, args: &[&str]) -> Result<Option<String>, WorkspaceError> {
    let output = run_git(repo, args, MAX_GIT_OUTPUT_BYTES).await?.0;
    Ok(String::from_utf8(output)
        .map_err(|_| WorkspaceError::InvalidPath)?
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(str::to_owned))
}
