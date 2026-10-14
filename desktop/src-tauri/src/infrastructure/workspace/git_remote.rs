use std::path::Path;

use serde::Serialize;

use super::{
    git_process::{run_git, run_git_read, run_network_git},
    git_read::repository_path,
    git_write::{PushCommitsResponse, validate_snapshot},
    path_guard::WorkspaceError,
};

const MAX_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRemoteState {
    pub head: Option<String>,
    pub upstream: Option<String>,
    pub remote: Option<String>,
    pub target_branch: Option<String>,
    pub remotes: Vec<Remote>,
    pub ahead: Option<u64>,
    pub behind: Option<u64>,
    pub checked_at: String,
    pub operation: &'static str,
    pub conflicts: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct Remote {
    pub name: String,
    pub url: String,
}

async fn text(repo: &Path, args: &[&str]) -> Result<String, WorkspaceError> {
    let (bytes, truncated) = run_git_read(repo, args, MAX_BYTES).await?;
    if truncated {
        return Err(WorkspaceError::GitOutputTooLarge {
            operation: "remote",
            maximum_bytes: MAX_BYTES,
        });
    }
    String::from_utf8(bytes)
        .map(|value| {
            if args.contains(&"-z") {
                value
            } else {
                value.trim().to_owned()
            }
        })
        .map_err(|_| WorkspaceError::GitPathEncoding)
}

async fn optional(repo: &Path, args: &[&str]) -> Option<String> {
    text(repo, args)
        .await
        .ok()
        .filter(|value| !value.is_empty())
}

fn redact_url(value: &str) -> String {
    if let Some((scheme, rest)) = value.split_once("://")
        && matches!(scheme, "http" | "https")
        && let Some((_, host)) = rest.split_once('@')
    {
        return format!("{scheme}://***@{host}");
    }
    value.to_owned()
}

/// 只读取本地配置和已获取引用；用户点击获取时才访问远端。
async fn inspect(repo: &Path) -> Result<GitRemoteState, WorkspaceError> {
    let (branch, head, names, upstream, merge_path, conflict_text) = tokio::join!(
        optional(repo, &["symbolic-ref", "--quiet", "--short", "HEAD"]),
        optional(repo, &["rev-parse", "--verify", "HEAD"]),
        text(repo, &["remote"]),
        optional(repo, &["rev-parse", "--abbrev-ref", "@{upstream}"]),
        text(repo, &["rev-parse", "--git-path", "MERGE_HEAD"]),
        text(repo, &["diff", "--name-only", "--diff-filter=U", "-z"]),
    );
    let mut remotes = Vec::new();
    for name in names?.lines().take(64) {
        remotes.push(Remote {
            name: name.to_owned(),
            url: redact_url(&text(repo, &["remote", "get-url", "--push", name]).await?),
        });
    }
    let remote_names = remotes
        .iter()
        .map(|remote| remote.name.as_str())
        .collect::<Vec<_>>();
    let (remote, target_branch) = push_target(repo, branch.as_deref(), &remote_names).await;
    let counts = if let (Some(remote), Some(branch), Some(_)) = (&remote, &target_branch, &head) {
        optional(
            repo,
            &[
                "rev-list",
                "--left-right",
                "--count",
                &format!("HEAD...refs/remotes/{remote}/{branch}"),
            ],
        )
        .await
    } else {
        None
    };
    let mut numbers = counts
        .as_deref()
        .unwrap_or("")
        .split_whitespace()
        .map(str::parse::<u64>);
    let ahead = numbers.next().and_then(Result::ok);
    let behind = numbers.next().and_then(Result::ok);
    let merging = tokio::fs::try_exists(repo.join(merge_path?)).await?;
    Ok(GitRemoteState {
        head,
        upstream,
        remote,
        target_branch,
        remotes,
        ahead,
        behind,
        checked_at: chrono::Utc::now().to_rfc3339(),
        operation: if merging { "merge" } else { "none" },
        conflicts: conflict_text?
            .split('\0')
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
            .collect(),
    })
}

/// 历史与推送共用目标解析；一次读取配置，避免每个历史条目重复启动 Git。
pub(super) async fn push_target(
    repo: &Path,
    branch: Option<&str>,
    remote_names: &[&str],
) -> (Option<String>, Option<String>) {
    let Some(branch) = branch else {
        return (None, None);
    };
    let config = optional(
        repo,
        &[
            "config",
            "--null",
            "--get-regexp",
            r"^(branch\..*\.(pushremote|remote|merge)|remote\.pushdefault|push\.default)$",
        ],
    )
    .await
    .unwrap_or_default();
    let values = config
        .split('\0')
        .filter_map(|record| record.split_once('\n'))
        .collect::<std::collections::HashMap<_, _>>();
    let config_value = |key: &str| {
        values
            .get(key)
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
    };
    let remote = config_value(&format!("branch.{branch}.pushremote"))
        .or_else(|| config_value("remote.pushdefault"))
        .or_else(|| config_value(&format!("branch.{branch}.remote")))
        .or_else(|| {
            if remote_names.len() == 1 {
                remote_names.first().copied()
            } else {
                None
            }
        })
        .map(str::to_owned);
    let target = if config_value("push.default") == Some("upstream") {
        config_value(&format!("branch.{branch}.merge"))
            .map_or(branch, |value| value.trim_start_matches("refs/heads/"))
    } else {
        branch
    };
    (remote, Some(target.to_owned()))
}

fn failure(message: &str) -> WorkspaceError {
    WorkspaceError::GitCommandFailed(message.to_owned())
}

pub struct RemoteAction<'a> {
    pub action: &'a str,
    pub remote: Option<&'a str>,
    pub url: Option<&'a str>,
    pub branch_name: Option<&'a str>,
    pub expected_head: Option<&'a str>,
    pub expected_branch: Option<&'a str>,
}

pub async fn operate_project_remote(
    root: &Path,
    repository: Option<&str>,
    expected_snapshot: &str,
    request: RemoteAction<'_>,
) -> Result<PushCommitsResponse, WorkspaceError> {
    let repo = repository_path(root, repository).await?;
    // 已有提交的网络操作只绑定 HEAD/分支，持续写入工作文件不阻塞推送。
    if matches!(request.action, "push" | "publish" | "fetch")
        && let (Some(head), Some(branch)) = (request.expected_head, request.expected_branch)
    {
        if optional(&repo, &["rev-parse", "--verify", "HEAD"])
            .await
            .as_deref()
            != Some(head)
            || optional(&repo, &["symbolic-ref", "--quiet", "--short", "HEAD"])
                .await
                .as_deref()
                != Some(branch)
        {
            return Err(WorkspaceError::SnapshotMismatch);
        }
    } else if request.action != "inspect" {
        // 只读检查允许旧快照，以便提交或工作文件变化后重新读取当前 HEAD；写操作仍校验快照。
        validate_snapshot(root, repository, expected_snapshot).await?;
    }
    operate_remote_with_head(
        &repo,
        request.action,
        request.remote,
        request.url,
        request.branch_name,
        request.expected_head,
    )
    .await
}

#[cfg(test)]
pub(super) async fn operate_remote(
    repo: &Path,
    action: &str,
    selected_remote: Option<&str>,
    url: Option<&str>,
    branch_name: Option<&str>,
) -> Result<PushCommitsResponse, WorkspaceError> {
    operate_remote_with_head(repo, action, selected_remote, url, branch_name, None).await
}

async fn operate_remote_with_head(
    repo: &Path,
    action: &str,
    selected_remote: Option<&str>,
    url: Option<&str>,
    branch_name: Option<&str>,
    expected_head: Option<&str>,
) -> Result<PushCommitsResponse, WorkspaceError> {
    let branch = optional(repo, &["symbolic-ref", "--quiet", "--short", "HEAD"]).await;
    let before = inspect(repo).await?;
    let remote = selected_remote.or(before.remote.as_deref());
    let operation = async {
        if remote.is_some_and(|name| {
            name.is_empty()
                || name.len() > 256
                || name.starts_with('-')
                || !name
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'.' | b'-'))
        }) {
            return Err(failure("Invalid remote name"));
        }
        match action {
            "inspect" => Ok("checked"),
            "branch" => {
                let name = branch_name
                    .filter(|value| {
                        !value.is_empty() && value.len() <= 1024 && !value.starts_with('-')
                    })
                    .ok_or_else(|| failure("Choose a valid feature branch name"))?;
                run_git(repo, &["check-ref-format", "--branch", name], MAX_BYTES).await?;
                run_git(repo, &["switch", "-c", name], MAX_BYTES).await?;
                Ok("updated")
            }
            "configure" => {
                let name = remote.ok_or_else(|| failure("Choose a remote name"))?;
                let url = url
                    .filter(|value| {
                        !value.is_empty()
                            && value.len() <= 4096
                            && !value.starts_with('-')
                            && !value.contains(['\0', '\r', '\n'])
                    })
                    .ok_or_else(|| failure("Invalid remote URL"))?;
                let command = if before.remotes.iter().any(|item| item.name == name) {
                    "set-url"
                } else {
                    "add"
                };
                run_git(repo, &["remote", command, name, url], MAX_BYTES).await?;
                Ok("updated")
            }
            "publish" | "push" | "fetch" | "integrate" => {
                let branch = branch
                    .as_deref()
                    .filter(|_| before.head.is_some())
                    .ok_or_else(|| failure("Create a branch and commit before publishing"))?;
                let remote = remote
                    .filter(|name| before.remotes.iter().any(|item| item.name == *name))
                    .ok_or_else(|| failure("No remote configured; choose a remote first"))?;
                if action == "publish" {
                    let target = format!("{}:refs/heads/{branch}", expected_head.unwrap_or("HEAD"));
                    run_network_git(
                        repo,
                        &["push", "--set-upstream", "--", remote, &target],
                        MAX_BYTES,
                    )
                    .await?;
                    if expected_head.is_some() {
                        run_git(
                            repo,
                            &[
                                "branch",
                                &format!("--set-upstream-to={remote}/{branch}"),
                                "--",
                                branch,
                            ],
                            MAX_BYTES,
                        )
                        .await?;
                    }
                    return Ok("pushed");
                }
                if action == "push" {
                    if before.operation != "none" {
                        return Err(failure("Complete or cancel the merge before pushing"));
                    }
                    if before.upstream.is_none() {
                        return Err(WorkspaceError::NoUpstream);
                    }
                    let target = format!(
                        "{}:refs/heads/{}",
                        expected_head.unwrap_or("HEAD"),
                        before.target_branch.as_deref().unwrap_or(branch)
                    );
                    run_network_git(repo, &["push", "--", remote, &target], MAX_BYTES).await?;
                    return Ok("pushed");
                }
                if action == "integrate" {
                    if before.operation != "none" {
                        return Err(failure("Complete or cancel the existing merge first"));
                    }
                    if !text(repo, &["status", "--porcelain", "--untracked-files=normal"])
                        .await?
                        .is_empty()
                    {
                        return Err(failure(
                            "Commit or set aside working changes before integrating remote updates",
                        ));
                    }
                    if before.upstream.is_none() {
                        return Err(WorkspaceError::NoUpstream);
                    }
                }
                run_network_git(repo, &["fetch", "--", remote], MAX_BYTES).await?;
                if action == "integrate" {
                    run_git(
                        repo,
                        &[
                            "merge",
                            // 仅快进；本软件不承担分叉合并及冲突处理，失败时保持本地提交与工作区。
                            "--ff-only",
                            &format!(
                                "refs/remotes/{remote}/{}",
                                before.target_branch.as_deref().unwrap_or(branch)
                            ),
                        ],
                        MAX_BYTES,
                    )
                    .await?;
                }
                Ok("updated")
            }
            _ => Err(failure("Unsupported Git remote action")),
        }
    }
    .await;
    let (push_status, push_error) = match operation {
        Ok(status) => (status, None),
        Err(WorkspaceError::NoUpstream) => (
            "not_configured",
            Some("Branch not published; publish it to a remote first".to_owned()),
        ),
        Err(error) => ("failed", Some(error.to_string())),
    };
    Ok(PushCommitsResponse {
        branch: optional(repo, &["symbolic-ref", "--quiet", "--short", "HEAD"]).await,
        push_status,
        push_error,
        remote_state: Some(inspect(repo).await?),
    })
}
