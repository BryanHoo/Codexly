use std::path::Path;

use super::{
    git_models::{CommitDiff, CommitFile, CommitFilesPage, GitCommit, GitHistoryPage},
    git_process::run_git_read,
    git_protocol::{
        MAX_DIFF_BYTES, MAX_METADATA_BYTES, PATCH_ARGS, invalid, literal_path, nul_records,
        parse_cursor, path_text, read_complete, validate_sha,
    },
    git_read::{git_lines, head_commit},
    git_repository::{repository_path, select_repository},
    git_status_parse::change_kind,
    path_guard::{WorkspaceError, valid_relative},
};

pub async fn get_git_history(
    root: &Path,
    repository: Option<&str>,
    cursor: Option<&str>,
) -> Result<GitHistoryPage, WorkspaceError> {
    let selected = select_repository(root, repository).await?;
    let offset = parse_cursor(cursor)?;
    let mut result = GitHistoryPage {
        branch: None,
        commits: Vec::new(),
        next_cursor: None,
        repositories: selected.repositories,
        repository: selected.repository,
        repository_mode: selected.mode,
    };
    let Some(repo) = selected.path else {
        return Ok(result);
    };
    let (head, branches) = tokio::try_join!(
        head_commit(&repo),
        git_lines(&repo, &["branch", "--show-current"])
    )?;
    result.branch = branches.into_iter().next();
    let Some(head) = head else {
        return Ok(result);
    };
    let skip = format!("--skip={offset}");
    // NUL 固定字段避免正文中的控制字符碰撞；固定 HEAD，避免读分支期间切换导致日志漂移。
    let output = read_complete(
        &repo,
        &[
            "log",
            "-21",
            &skip,
            "-z",
            "--no-color",
            "--no-show-signature",
            "--format=%H%x00%an%x00%ae%x00%aI%x00%s",
            &head,
            "--",
        ],
        "history",
        MAX_METADATA_BYTES,
    )
    .await?;
    result.commits = parse_history(&output)?;
    result.next_cursor = (result.commits.len() > 20).then(|| offset.saturating_add(20).to_string());
    result.commits.truncate(20);
    Ok(result)
}

pub async fn get_commit_files(
    root: &Path,
    repository: Option<&str>,
    sha: &str,
    cursor: Option<&str>,
) -> Result<CommitFilesPage, WorkspaceError> {
    validate_sha(sha)?;
    let repo = repository_path(root, repository).await?;
    // 合并提交按第一父提交比较，文件列表和单文件 Diff 使用完全相同的语义。
    let offset = parse_cursor(cursor)?;
    let (pending, files, count) = super::git_stream::fold_records(
        &repo,
        &[
            "diff-tree",
            "--root",
            "--no-commit-id",
            "--name-status",
            "--no-renames",
            "--no-relative",
            "--diff-merges=first-parent",
            "-r",
            "-z",
            sha,
            "--",
        ],
        (None, Vec::new(), 0_usize),
        |(pending, files, count), record| {
            let record = &record[..record.len() - 1];
            if let Some(code) = pending.take() {
                let path = path_text(record)?;
                if *count >= offset && files.len() < 100 {
                    files.push(CommitFile {
                        kind: change_kind(code),
                        path: path.to_owned(),
                    });
                }
                *count += 1;
            } else {
                *pending = Some(
                    *record
                        .first()
                        .ok_or_else(|| invalid("commit files", "empty status"))?,
                );
            }
            Ok(())
        },
    )
    .await?;
    if pending.is_some() {
        return Err(invalid("commit files", "missing path"));
    }
    let next = offset.saturating_add(100);
    Ok(CommitFilesPage {
        files,
        next_cursor: (next < count).then(|| next.to_string()),
    })
}

pub async fn get_commit_diff(
    root: &Path,
    repository: Option<&str>,
    sha: &str,
    relative: &str,
) -> Result<CommitDiff, WorkspaceError> {
    validate_sha(sha)?;
    valid_relative(relative)?;
    let repo = repository_path(root, repository).await?;
    let path = literal_path(relative);
    let mut args = vec![
        "show",
        "--format=",
        "--no-renames",
        "--diff-merges=first-parent",
    ];
    args.extend_from_slice(PATCH_ARGS);
    args.extend([sha, "--", &path]);
    let (output, truncated) = run_git_read(&repo, &args, MAX_DIFF_BYTES).await?;
    Ok(CommitDiff {
        diff: super::git_diff::patch_text(&output, MAX_DIFF_BYTES),
        truncated,
    })
}

fn parse_history(output: &[u8]) -> Result<Vec<GitCommit>, WorkspaceError> {
    let mut fields = nul_records(output, "history")?;
    let mut commits = Vec::new();
    while let Some(sha) = fields.next() {
        let mut field = || {
            fields
                .next()
                .map(|value| String::from_utf8_lossy(value).into_owned())
                .ok_or_else(|| invalid("history", "incomplete commit record"))
        };
        let sha = std::str::from_utf8(sha).map_err(|_| invalid("history", "invalid object id"))?;
        validate_sha(sha)?;
        commits.push(GitCommit {
            sha: sha.to_owned(),
            author_name: field()?,
            author_email: field()?,
            authored_at: field()?,
            title: field()?,
        });
    }
    Ok(commits)
}
