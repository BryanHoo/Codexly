use std::path::Path;

use super::{
    git_process::run_git_read,
    path_guard::{WorkspaceError, valid_relative},
};

pub(super) const MAX_METADATA_BYTES: usize = 2 * 1024 * 1024;
pub(super) const MAX_DIFF_BYTES: usize = 512 * 1024;

pub(super) fn invalid(operation: &'static str, detail: &'static str) -> WorkspaceError {
    WorkspaceError::GitOutputInvalid { operation, detail }
}

/// 结构化输出必须完整，不能将超限的半条记录交给解析器。
pub(super) async fn read_complete(
    repo: &Path,
    args: &[&str],
    operation: &'static str,
    limit: usize,
) -> Result<Vec<u8>, WorkspaceError> {
    let (output, truncated) = run_git_read(repo, args, limit).await?;
    if truncated {
        return Err(WorkspaceError::GitOutputTooLarge {
            operation,
            maximum_bytes: limit,
        });
    }
    Ok(output)
}

pub(super) fn nul_records<'a>(
    output: &'a [u8],
    operation: &'static str,
) -> Result<impl Iterator<Item = &'a [u8]>, WorkspaceError> {
    let body = if output.is_empty() {
        output
    } else {
        output
            .strip_suffix(&[0])
            .ok_or_else(|| invalid(operation, "missing NUL terminator"))?
    };
    Ok(body
        .split(|byte| *byte == 0)
        .filter(move |_| !output.is_empty()))
}

pub(super) fn path_text(value: &[u8]) -> Result<&str, WorkspaceError> {
    let value = std::str::from_utf8(value).map_err(|_| WorkspaceError::GitPathEncoding)?;
    valid_relative(value)?;
    Ok(value)
}

pub(super) fn literal_path(value: &str) -> String {
    format!(":(top,literal){value}")
}

pub(super) fn validate_sha(sha: &str) -> Result<(), WorkspaceError> {
    if matches!(sha.len(), 40 | 64) && sha.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        Ok(())
    } else {
        Err(invalid(
            "revision",
            "expected a full SHA-1 or SHA-256 object id",
        ))
    }
}

pub(super) fn parse_cursor(cursor: Option<&str>) -> Result<usize, WorkspaceError> {
    cursor
        .unwrap_or("0")
        .parse()
        .map_err(|_| invalid("pagination", "invalid cursor"))
}

/// 强制稳定补丁格式，忽略用户的颜色、路径前缀、外部 diff/textconv 与子模块显示偏好。
pub(super) const PATCH_ARGS: &[&str] = &[
    "--no-ext-diff",
    "--no-textconv",
    "--no-color",
    "--no-relative",
    "--src-prefix=a/",
    "--dst-prefix=b/",
    "--submodule=short",
];

/// diff/ls-files 不接受 pathspec-from-file；按字节分批，兼容 Windows 的短命令行预算。
pub(super) fn path_batches<T: AsRef<str>>(paths: &[T]) -> impl Iterator<Item = &[T]> {
    let mut offset = 0;
    std::iter::from_fn(move || {
        if offset == paths.len() {
            return None;
        }
        let start = offset;
        let mut bytes = 0;
        while offset < paths.len() {
            let size = paths[offset].as_ref().len() + 32;
            if offset > start && bytes + size > 8 * 1024 {
                break;
            }
            bytes += size;
            offset += 1;
        }
        Some(&paths[start..offset])
    })
}
