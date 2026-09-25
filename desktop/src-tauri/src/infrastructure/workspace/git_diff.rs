use std::{collections::HashMap, path::Path};

use super::{
    git_process::run_git_read,
    git_protocol::{MAX_DIFF_BYTES, MAX_METADATA_BYTES, PATCH_ARGS, invalid, path_text},
    git_read::GitChange,
    path_guard::WorkspaceError,
};

pub(super) async fn add_diffs(
    repo: &Path,
    changes: &mut [GitChange],
    staged: bool,
) -> Result<(), WorkspaceError> {
    add_diffs_inner(repo, changes, staged, false).await
}

pub(super) async fn add_file_diff(
    repo: &Path,
    changes: &mut [GitChange],
    staged: bool,
) -> Result<(), WorkspaceError> {
    add_diffs_inner(repo, changes, staged, true).await
}

async fn add_diffs_inner(
    repo: &Path,
    changes: &mut [GitChange],
    staged: bool,
    single: bool,
) -> Result<(), WorkspaceError> {
    if changes.is_empty() {
        return Ok(());
    }
    if staged || changes.iter().any(|change| change.kind != "create") {
        let mut args = vec!["diff", "--raw", "-z", "--patch"];
        args.extend_from_slice(PATCH_ARGS);
        if staged {
            args.push("--cached");
        } else {
            // 冲突使用 merge base 与工作区的普通补丁，避免 combined diff 破坏单文件渲染契约。
            args.push("--base");
        }
        let paths: Vec<_> = changes
            .iter()
            .flat_map(|change| {
                std::iter::once(change.path.as_str()).chain(change.original_path.as_deref())
            })
            .map(super::git_protocol::literal_path)
            .collect();
        if single {
            args.push("--");
            args.extend(paths.iter().map(String::as_str));
        }
        let (output, truncated) = run_git_read(
            repo,
            &args,
            if single {
                MAX_DIFF_BYTES
            } else {
                MAX_METADATA_BYTES
            },
        )
        .await?;
        apply_combined_diff(&output, changes, truncated)?;
    }
    if !staged {
        add_untracked_diffs(repo, changes).await?;
    }
    Ok(())
}

async fn add_untracked_diffs(repo: &Path, changes: &mut [GitChange]) -> Result<(), WorkspaceError> {
    let mut remaining =
        MAX_METADATA_BYTES.saturating_sub(changes.iter().map(|change| change.diff.len()).sum());
    for change in changes.iter_mut().filter(|change| change.kind == "create") {
        let limit = remaining.min(MAX_DIFF_BYTES);
        if limit == 0 {
            change.truncated = true;
            continue;
        }
        // 目录在状态中保持聚合，具体文件由提交上下文按需展开；符号链接只读链接文本。
        if change.path.ends_with('/') {
            continue;
        }
        let content =
            match super::git_untracked::read_content(&repo.join(&change.path), repo, limit + 1)
                .await
            {
                Ok(content) => content,
                Err(WorkspaceError::Io(error)) if error.kind() == std::io::ErrorKind::NotFound => {
                    continue;
                }
                Err(error) => return Err(error),
            };
        if content.contains(&0) {
            continue;
        }
        let patch = super::git_patch::untracked_patch(
            &change.path,
            &String::from_utf8_lossy(&content),
            limit,
        );
        change.truncated = patch.truncated || content.len() > limit;
        let diff = patch.diff;
        remaining = remaining.saturating_sub(diff.len());
        change.stats = crate::domain::file_change::FileChangeStats::patch(&diff);
        change.diff = diff;
    }
    Ok(())
}

fn apply_combined_diff(
    output: &[u8],
    changes: &mut [GitChange],
    truncated: bool,
) -> Result<(), WorkspaceError> {
    if output.is_empty() {
        return Ok(());
    }
    if truncated {
        // 总预算用尽时，尚未附带正文的条目也必须显式标记为不完整。
        for change in changes.iter_mut() {
            change.truncated = true;
        }
    }
    let Some(separator) = memchr::memmem::find(output, &[0, 0]) else {
        // 只有冲突元数据而无补丁，或预算耗尽于元数据部分，都不能伪造文件正文。
        if truncated || output.ends_with(&[0]) {
            return Ok(());
        }
        return Err(invalid("diff", "incomplete raw metadata"));
    };
    let mut fields = output[..separator].split(|byte| *byte == 0);
    let mut paths = Vec::new();
    while let Some(metadata) = fields.next() {
        let status = metadata
            .rsplit(|byte| *byte == b' ')
            .next()
            .and_then(|value| value.first())
            .ok_or_else(|| invalid("diff", "missing raw status"))?;
        let first = fields
            .next()
            .ok_or_else(|| invalid("diff", "missing raw path"))?;
        let path = if matches!(status, b'R' | b'C') {
            fields
                .next()
                .ok_or_else(|| invalid("diff", "missing rename destination"))?
        } else {
            first
        };
        // --base 为冲突文件同时输出 U 与 M；U 本身没有对应补丁。
        if *status != b'U' {
            paths.push(path_text(path)?);
        }
    }
    let patches = split_patch_chunks(&output[separator + 2..]);
    if !truncated && patches.len() != paths.len() {
        return Err(invalid("diff", "raw metadata and patches disagree"));
    }
    let indexes: HashMap<_, _> = changes
        .iter()
        .enumerate()
        .map(|(index, change)| (change.path.as_str(), index))
        .collect();
    let assignments: Vec<_> = paths
        .into_iter()
        .zip(patches)
        .filter_map(|(path, patch)| indexes.get(path).copied().map(|index| (index, patch)))
        .collect();
    for (index, patch) in assignments {
        changes[index].diff = patch_text(patch, MAX_DIFF_BYTES);
        changes[index].truncated = patch.len() > MAX_DIFF_BYTES
            || (truncated && patch.as_ptr_range().end == output.as_ptr_range().end);
        changes[index].stats =
            crate::domain::file_change::FileChangeStats::patch(&changes[index].diff);
    }
    Ok(())
}

pub(super) use super::git_patch::patch_text;

fn split_patch_chunks(output: &[u8]) -> Vec<&[u8]> {
    const HEADER: &[u8] = b"diff --git ";
    let mut starts = Vec::new();
    let mut offset = 0;
    for line in output.split_inclusive(|byte| *byte == b'\n') {
        if line.starts_with(HEADER) {
            starts.push(offset);
        }
        offset += line.len();
    }
    starts
        .iter()
        .enumerate()
        .map(|(index, start)| {
            let end = starts.get(index + 1).copied().unwrap_or(output.len());
            &output[*start..end]
        })
        .collect()
}
