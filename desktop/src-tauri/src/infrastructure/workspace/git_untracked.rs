use std::path::Path;

use tokio::io::AsyncReadExt;

use super::path_guard::WorkspaceError;

/// Git 保存链接文本，不能把链接所指文件的正文发送到模型上下文。
pub(super) async fn read_content(
    path: &Path,
    repo: &Path,
    limit: usize,
) -> Result<Vec<u8>, WorkspaceError> {
    if limit == 0 {
        return Ok(Vec::new());
    }
    let parent = path.parent().ok_or(WorkspaceError::InvalidPath)?;
    if !tokio::fs::canonicalize(parent).await?.starts_with(repo) {
        return Err(WorkspaceError::InvalidPath);
    }
    let metadata = tokio::fs::symlink_metadata(path).await?;
    if metadata.is_symlink() {
        let target = tokio::fs::read_link(path).await?;
        let text = target.to_string_lossy();
        return Ok(text.as_bytes()[..limit.min(text.len())].to_vec());
    }
    if !metadata.is_file() {
        return Err(WorkspaceError::InvalidPath);
    }
    let mut options = tokio::fs::OpenOptions::new();
    options.read(true);
    // 打开时再次禁止跟随链接，避免检查与读取之间替换目标。
    #[cfg(unix)]
    options.custom_flags(nix::libc::O_NOFOLLOW);
    #[cfg(windows)]
    options.custom_flags(0x0020_0000); // FILE_FLAG_OPEN_REPARSE_POINT
    let file = options.open(path).await?;
    if !file.metadata().await?.is_file() {
        return Err(WorkspaceError::InvalidPath);
    }
    let mut bytes = Vec::with_capacity(limit.min(8 * 1024));
    file.take(limit as u64).read_to_end(&mut bytes).await?;
    Ok(bytes)
}
