use std::{collections::HashSet, path::Path};

use super::{
    git_process::run_git_read as run_git,
    git_read::repository_path,
    git_write::{CommitMessageContext, validate_paths, validate_snapshot},
    path_guard::WorkspaceError,
};

const MAX_COMMIT_CONTEXT_BYTES: usize = 512 * 1024;

pub async fn prepare_commit_message(
    root: &Path,
    repository: Option<&str>,
    paths: &[String],
    expected_snapshot: &str,
) -> Result<CommitMessageContext, WorkspaceError> {
    validate_paths(paths)?;
    let status = validate_snapshot(root, repository, expected_snapshot).await?;
    let repo = repository_path(root, repository).await?;
    let selected: HashSet<_> = paths.iter().map(String::as_str).collect();
    let staged: Vec<_> = status
        .staged
        .iter()
        .filter(|change| selected.contains(change.path.as_str()))
        .collect();
    let unstaged: Vec<_> = status
        .unstaged
        .iter()
        .filter(|change| selected.contains(change.path.as_str()))
        .collect();
    if staged.is_empty() && unstaged.is_empty() {
        return Err(WorkspaceError::InvalidPath);
    }
    let mut changes = format!(
        "Selected changes: {} staged, {} unstaged\n",
        staged.len(),
        unstaged.len()
    );
    for (area, change) in staged
        .iter()
        .map(|change| ("staged", *change))
        .chain(unstaged.iter().map(|change| ("unstaged", *change)))
        .take(128)
    {
        append_bounded(
            &mut changes,
            &format!("## {area}: {} ({})\n", change.path, change.kind),
            MAX_COMMIT_CONTEXT_BYTES,
        );
    }

    append_selected_diff(
        &repo,
        &staged
            .iter()
            .flat_map(|change| {
                std::iter::once(change.path.as_str()).chain(change.original_path.as_deref())
            })
            .collect::<Vec<_>>(),
        true,
        &mut changes,
    )
    .await?;
    let tracked_unstaged: Vec<_> = unstaged
        .iter()
        .filter(|change| change.kind != "create")
        .flat_map(|change| {
            std::iter::once(change.path.as_str()).chain(change.original_path.as_deref())
        })
        .collect();
    append_selected_diff(&repo, &tracked_unstaged, false, &mut changes).await?;

    let mut directories = Vec::new();
    for change in unstaged.iter().filter(|change| change.kind == "create") {
        // porcelain normal 用尾部斜杠标记聚合目录，不能将该条目当成文件打开。
        if change.path.ends_with('/') {
            directories.push(super::git_protocol::literal_path(&change.path));
        } else {
            append_untracked_file(&repo, &change.path, &mut changes).await?;
        }
    }
    for batch in super::git_protocol::path_batches(&directories) {
        append_untracked_directories(&repo, batch, &mut changes).await?;
        if changes.len() >= MAX_COMMIT_CONTEXT_BYTES {
            break;
        }
    }
    Ok(CommitMessageContext {
        changes,
        snapshot: status.snapshot,
    })
}

async fn append_untracked_directories(
    repo: &Path,
    directories: &[String],
    target: &mut String,
) -> Result<(), WorkspaceError> {
    if directories.is_empty() || target.len() >= MAX_COMMIT_CONTEXT_BYTES {
        return Ok(());
    }
    // 一次 Git 调用仅展开所选目录，遵循 ignore 规则，并按字面量处理路径中的通配符。
    let mut args = vec!["ls-files", "--others", "--exclude-standard", "-z", "--"];
    args.extend(directories.iter().map(String::as_str));
    let (output, _) = run_git(repo, &args, MAX_COMMIT_CONTEXT_BYTES).await?;
    // 有界输出可能截在文件名中间，只消费 NUL 结尾的完整记录。
    for record in output.split_inclusive(|byte| *byte == 0) {
        if target.len() >= MAX_COMMIT_CONTEXT_BYTES {
            break;
        }
        let Some(path) = record.strip_suffix(&[0]) else {
            break;
        };
        let path = std::str::from_utf8(path).map_err(|_| WorkspaceError::InvalidPath)?;
        super::path_guard::valid_relative(path)?;
        append_untracked_file(repo, path, target).await?;
    }
    Ok(())
}

async fn append_untracked_file(
    repo: &Path,
    relative: &str,
    target: &mut String,
) -> Result<(), WorkspaceError> {
    append_bounded(
        target,
        &format!("## untracked: {relative}\n"),
        MAX_COMMIT_CONTEXT_BYTES,
    );
    if target.len() >= MAX_COMMIT_CONTEXT_BYTES {
        return Ok(());
    }
    if relative.ends_with('/') {
        // ls-files 将嵌套仓库作为 gitlink 返回；提交的是 HEAD，不能展开其内部文件。
        let nested = tokio::fs::canonicalize(repo.join(relative)).await?;
        if !nested.starts_with(repo) {
            return Err(WorkspaceError::InvalidPath);
        }
        let head = super::git_read::head_commit(&nested).await?;
        append_bounded(
            target,
            &format!("gitlink {}\n", head.as_deref().unwrap_or("(initial)")),
            MAX_COMMIT_CONTEXT_BYTES,
        );
        return Ok(());
    }
    // 未跟踪文件没有 Git diff，仅读取剩余容量，并复用禁止跟随符号链接的读取逻辑。
    let remaining = MAX_COMMIT_CONTEXT_BYTES.saturating_sub(target.len());
    let content = super::git_untracked::read_content(&repo.join(relative), repo, remaining).await?;
    append_bounded(
        target,
        &String::from_utf8_lossy(&content),
        MAX_COMMIT_CONTEXT_BYTES,
    );
    append_bounded(target, "\n", MAX_COMMIT_CONTEXT_BYTES);
    Ok(())
}

async fn append_selected_diff(
    repo: &Path,
    paths: &[&str],
    staged: bool,
    target: &mut String,
) -> Result<(), WorkspaceError> {
    if paths.is_empty() || target.len() >= MAX_COMMIT_CONTEXT_BYTES {
        return Ok(());
    }
    for batch in super::git_protocol::path_batches(paths) {
        if target.len() >= MAX_COMMIT_CONTEXT_BYTES {
            break;
        }
        let literal_paths: Vec<_> = batch
            .iter()
            .map(|path| super::git_protocol::literal_path(path))
            .collect();
        let mut args = vec!["diff"];
        args.extend_from_slice(super::git_protocol::PATCH_ARGS);
        if staged {
            args.push("--cached");
        }
        args.push("--");
        args.extend(literal_paths.iter().map(String::as_str));
        let remaining = MAX_COMMIT_CONTEXT_BYTES - target.len();
        let (diff, _) = run_git(repo, &args, remaining).await?;
        append_bounded(
            target,
            &String::from_utf8_lossy(&diff),
            MAX_COMMIT_CONTEXT_BYTES,
        );
    }
    Ok(())
}

fn append_bounded(target: &mut String, value: &str, limit: usize) {
    let remaining = limit.saturating_sub(target.len());
    let end = value.floor_char_boundary(remaining.min(value.len()));
    target.push_str(&value[..end]);
}
