use std::path::Path;

use sha2::{Digest, Sha256};

use super::{
    git_diff::add_diffs,
    git_protocol::{MAX_METADATA_BYTES, invalid, read_complete},
    git_repository::select_repository,
    git_status_parse::parse_status,
    path_guard::WorkspaceError,
};

pub use super::git_history::{get_commit_diff, get_commit_files, get_git_history};
pub use super::git_models::{GitChange, GitStatus};
pub(super) use super::git_repository::repository_path;

#[cfg(test)]
pub async fn get_git_status(
    root: &Path,
    repository: Option<&str>,
    include_diff: bool,
) -> Result<GitStatus, WorkspaceError> {
    // 文件正在被编辑时只重新取一次快照，避免瞬时竞态直接变成界面错误或无限重试。
    match read_git_status(root, repository, include_diff, false).await {
        Err(WorkspaceError::SnapshotMismatch) => {
            read_git_status(root, repository, include_diff, false).await
        }
        result => result,
    }
}

pub(super) async fn get_git_status_with_stats(
    root: &Path,
    repository: Option<&str>,
) -> Result<GitStatus, WorkspaceError> {
    match read_status(root, repository, false, false, true).await {
        Err(WorkspaceError::SnapshotMismatch) => {
            read_status(root, repository, false, false, true).await
        }
        result => result,
    }
}

pub(super) async fn read_git_status(
    root: &Path,
    repository: Option<&str>,
    include_diff: bool,
    strict: bool,
) -> Result<GitStatus, WorkspaceError> {
    read_status(root, repository, include_diff, strict, false).await
}

async fn read_status(
    root: &Path,
    repository: Option<&str>,
    include_diff: bool,
    strict: bool,
    include_stats: bool,
) -> Result<GitStatus, WorkspaceError> {
    let selected = select_repository(root, repository).await?;
    let Some(repo) = selected.path else {
        return Ok(GitStatus {
            stats: None,
            next_cursor: None,
            total_changes: None,
            base_branches: Vec::new(),
            branch: None,
            branches: Vec::new(),
            repository_mode: selected.mode,
            snapshot: hash_parts(selected.repositories.iter().map(String::as_bytes)),
            staged: Vec::new(),
            unstaged: Vec::new(),
        });
    };
    // v2 分支头同时提供 HEAD 与分支名，消除额外进程与两次查询之间的身份漂移。
    let status_args = [
        "status",
        "--porcelain=v2",
        "--branch",
        "--no-ahead-behind",
        "-z",
        "--untracked-files=normal",
        "--ignore-submodules=none",
    ];
    let ((mut status, status_hash), branches) = tokio::try_join!(
        read_status_records(&repo, &status_args),
        git_lines(
            &repo,
            &["for-each-ref", "--format=%(refname:short)", "refs/heads"]
        ),
    )?;
    let fingerprint = super::git_snapshot::content_fingerprint(
        &repo,
        &mut status.unstaged,
        &status.gitlinks,
        strict,
    )
    .await?;
    // 仅 UI 清单读取 numstat；写入校验和单文件预览不额外计算全仓统计。
    let stats = if include_stats {
        Some(super::git_stats::read_stats(&repo, &mut status.staged, &mut status.unstaged).await?)
    } else {
        None
    };
    if include_diff {
        add_diffs(&repo, &mut status.staged, true).await?;
        add_diffs(&repo, &mut status.unstaged, false).await?;
    }
    let snapshot = hash_parts([status_hash.as_slice(), fingerprint.as_bytes()]);
    Ok(GitStatus {
        stats,
        next_cursor: None,
        total_changes: None,
        base_branches: branches
            .iter()
            .filter(|branch| matches!(branch.as_str(), "main" | "master"))
            .cloned()
            .collect(),
        branch: status.branch,
        branches,
        repository_mode: selected.mode,
        snapshot,
        staged: status.staged,
        unstaged: status.unstaged,
    })
}

fn hash_parts<'a>(parts: impl IntoIterator<Item = &'a [u8]>) -> String {
    let mut hasher = Sha256::new();
    for part in parts {
        hasher.update(part);
        hasher.update([0]);
    }
    crate::encoding::encode_lower_hex(hasher.finalize())
}

pub(super) async fn git_lines(repo: &Path, args: &[&str]) -> Result<Vec<String>, WorkspaceError> {
    let output = read_complete(repo, args, "references", MAX_METADATA_BYTES).await?;
    Ok(std::str::from_utf8(&output)
        .map_err(|_| invalid("references", "invalid UTF-8"))?
        .lines()
        .filter(|line| !line.is_empty())
        .map(str::to_owned)
        .collect())
}

/// unborn 分支没有提交，其他命令失败保留 Git 原始错误。
pub(super) async fn head_commit(repo: &Path) -> Result<Option<String>, WorkspaceError> {
    Ok(git_lines(repo, &["rev-parse", "--revs-only", "HEAD"])
        .await?
        .into_iter()
        .next())
}

/// 单文件预览只读取该路径的状态与正文，不计算全仓内容快照。
pub async fn get_git_file_status(
    root: &Path,
    repository: Option<&str>,
    path: &str,
    staged: bool,
) -> Result<GitStatus, WorkspaceError> {
    static DIFF_SLOTS: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(2);
    let _permit = DIFF_SLOTS
        .acquire()
        .await
        .map_err(|_| invalid("diff", "reader closed"))?;
    super::path_guard::valid_relative(path)?;
    let repo = repository_path(root, repository).await?;
    let literal = super::git_protocol::literal_path(path);
    let output = read_complete(
        &repo,
        &[
            "status",
            "--porcelain=v2",
            "-z",
            "--untracked-files=normal",
            "--",
            &literal,
        ],
        "file status",
        MAX_METADATA_BYTES,
    )
    .await?;
    let mut parsed = parse_status(&output)?;
    let changes = if staged {
        &mut parsed.staged
    } else {
        &mut parsed.unstaged
    };
    changes.retain(|change| change.path == path);
    super::git_diff::add_file_diff(&repo, changes, staged).await?;
    Ok(GitStatus {
        stats: None,
        next_cursor: None,
        total_changes: None,
        base_branches: Vec::new(),
        branch: None,
        branches: Vec::new(),
        repository_mode: if repository.is_some() {
            "children"
        } else {
            "root"
        },
        snapshot: hash_parts([output.as_slice()]),
        staged: if staged { parsed.staged } else { Vec::new() },
        unstaged: if staged { Vec::new() } else { parsed.unstaged },
    })
}

async fn read_status_records(
    repo: &Path,
    args: &[&str],
) -> Result<(super::git_status_parse::StatusRecords, Vec<u8>), WorkspaceError> {
    let (status, hash, pending) = super::git_stream::fold_records(
        repo,
        args,
        (
            super::git_status_parse::StatusRecords::default(),
            Sha256::new(),
            Vec::new(),
        ),
        |(status, hash, pending), record| {
            hash.update(record);
            // rename 的源路径是独立 NUL 记录，必须与前一条一起解析。
            if pending.is_empty() && record.starts_with(b"2 ") {
                pending.extend_from_slice(record);
                return Ok(());
            }
            let parsed = if pending.is_empty() {
                parse_status(record)?
            } else {
                pending.extend_from_slice(record);
                let parsed = parse_status(pending)?;
                pending.clear();
                parsed
            };
            if parsed.branch.is_some() {
                status.branch = parsed.branch;
            }
            if parsed.head.is_some() {
                status.head = parsed.head;
            }
            status.staged.extend(parsed.staged);
            status.unstaged.extend(parsed.unstaged);
            status.gitlinks.extend(parsed.gitlinks);
            Ok(())
        },
    )
    .await?;
    if !pending.is_empty() {
        return Err(invalid("status", "missing rename source"));
    }
    Ok((status, hash.finalize().to_vec()))
}
