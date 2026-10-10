use super::WorkspaceError;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs::{self, File, Metadata},
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    sync::{Arc, LazyLock, Mutex, Weak},
};

const MAX_TEXT_BYTES: usize = 2 * 1024 * 1024;
type SaveLocks = Mutex<HashMap<PathBuf, Weak<Mutex<()>>>>;
static SAVE_LOCKS: LazyLock<SaveLocks> = LazyLock::new(|| Mutex::new(HashMap::new()));

#[derive(Debug, Serialize)]
pub struct TextFile {
    pub path: String,
    pub content: String,
    pub version: String,
    pub revision: String,
}
#[derive(Debug, Serialize)]
pub struct TextFileRevision {
    pub revision: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveTextInput {
    pub path: String,
    pub content: String,
    pub expected_version: String,
}
#[derive(Debug, Serialize)]
pub struct SavedTextFile {
    pub version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub revision: Option<String>,
}

fn revision_of(metadata: &Metadata) -> Result<String, WorkspaceError> {
    // 元数据标记用于缓存校验，不代替保存时的全文 SHA-256；忽略读取导致变化的 atime。
    let mut fingerprint = format!(
        "{}:{:?}:{:?}",
        metadata.len(),
        metadata.modified()?,
        metadata.created().ok()
    );
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        fingerprint.push_str(&format!(
            ":{}:{}:{}:{}",
            metadata.dev(),
            metadata.ino(),
            metadata.ctime(),
            metadata.ctime_nsec()
        ));
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        fingerprint.push_str(&format!(
            ":{}:{}:{}",
            metadata.creation_time(),
            metadata.last_write_time(),
            metadata.file_attributes()
        ));
    }
    Ok(crate::encoding::encode_lower_hex(Sha256::digest(
        fingerprint.as_bytes(),
    )))
}

pub fn read_text_file_revision(
    root: &Path,
    path: &str,
) -> Result<TextFileRevision, WorkspaceError> {
    let (target, _) = resolve_target(root, path)?;
    // 路径权限与完整读取一致；只做 stat，避免切屏触发文件正文 I/O 与 IPC 传输。
    let metadata = fs::symlink_metadata(target)?;
    if !metadata.is_file() || metadata.len() > MAX_TEXT_BYTES as u64 {
        return Err(WorkspaceError::TextFileUnsupported);
    }
    Ok(TextFileRevision {
        revision: revision_of(&metadata)?,
    })
}

fn resolve_target(root: &Path, requested: &str) -> Result<(PathBuf, String), WorkspaceError> {
    let canonical_root = fs::canonicalize(root)?;
    let requested = Path::new(requested);
    let relative = if requested.is_absolute() {
        requested
            .strip_prefix(root)
            .or_else(|_| requested.strip_prefix(&canonical_root))
            .map_err(|_| WorkspaceError::TextFileUnsupported)?
    } else {
        requested
    };
    if relative.as_os_str().is_empty() {
        return Err(WorkspaceError::TextFileUnsupported);
    }
    let mut target = canonical_root;
    for component in relative.components() {
        let Component::Normal(segment) = component else {
            return Err(WorkspaceError::TextFileUnsupported);
        };
        let segment_text = segment
            .to_str()
            .ok_or(WorkspaceError::TextFileUnsupported)?;
        if segment_text.eq_ignore_ascii_case(".git") || segment_text.contains([':', '\\']) {
            return Err(WorkspaceError::TextFileUnsupported);
        }
        target.push(segment);
        // 编辑不沿用预览的宽松路径语义；逐段检查，拒绝符号链接与项目外文件。
        if fs::symlink_metadata(&target)?.file_type().is_symlink() {
            return Err(WorkspaceError::TextFileUnsupported);
        }
    }
    let extension = target
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if [
        "doc", "docx", "odt", "rtf", "xls", "xlsx", "ppt", "pptx", "pdf", "zip", "png", "jpg",
        "jpeg", "gif", "webp", "woff", "woff2",
    ]
    .contains(&extension.as_str())
    {
        return Err(WorkspaceError::TextFileUnsupported);
    }
    let path = relative
        .to_str()
        .ok_or(WorkspaceError::TextFileUnsupported)?
        .replace(std::path::MAIN_SEPARATOR, "/");
    Ok((target, path))
}

fn validate_text(content: &str) -> Result<(), WorkspaceError> {
    let bytes = content.as_bytes();
    if bytes.len() > MAX_TEXT_BYTES || bytes.iter().any(|b| matches!(b, 0..=8 | 11..=12 | 14..=31))
    {
        return Err(WorkspaceError::TextFileUnsupported);
    }
    let crlf = content.contains("\r\n");
    for (index, byte) in bytes.iter().enumerate() {
        if (*byte == b'\r' && bytes.get(index + 1) != Some(&b'\n'))
            || (crlf && *byte == b'\n' && (index == 0 || bytes[index - 1] != b'\r'))
        {
            return Err(WorkspaceError::TextFileUnsupported);
        }
    }
    Ok(())
}
fn version_of(content: &str) -> String {
    crate::encoding::encode_lower_hex(Sha256::digest(content.as_bytes()))
}
fn snapshot(path: &Path) -> Result<(String, Metadata), WorkspaceError> {
    let file = File::open(path)?;
    let before = file.metadata()?;
    if !before.is_file() || before.len() > MAX_TEXT_BYTES as u64 {
        return Err(WorkspaceError::TextFileUnsupported);
    }
    let mut content = String::with_capacity(before.len() as usize);
    // take 限制 stat 后文件增长导致的内存占用，UTF-8 解码错误直接拒绝。
    (&file)
        .take(MAX_TEXT_BYTES as u64 + 1)
        .read_to_string(&mut content)
        .map_err(|_| WorkspaceError::TextFileUnsupported)?;
    let after = file.metadata()?;
    if content.len() as u64 != before.len()
        || revision_of(&before)? != revision_of(&after)?
        || revision_of(&before)? != revision_of(&fs::symlink_metadata(path)?)?
    {
        return Err(WorkspaceError::TextFileConflict);
    }
    validate_text(&content)?;
    Ok((content, before))
}

pub fn read_text_file(root: &Path, path: &str) -> Result<TextFile, WorkspaceError> {
    let (target, path) = resolve_target(root, path)?;
    let (content, metadata) = snapshot(&target)?;
    Ok(TextFile {
        path,
        version: version_of(&content),
        revision: revision_of(&metadata)?,
        content,
    })
}

pub fn save_text_file(root: &Path, input: &SaveTextInput) -> Result<SavedTextFile, WorkspaceError> {
    validate_text(&input.content)?;
    let (target, _) = resolve_target(root, &input.path)?;
    let lock = {
        let mut locks = SAVE_LOCKS
            .lock()
            .map_err(|_| WorkspaceError::TextFileConflict)?;
        // 弱引用在保存结束后释放锁对象，定期清除失效键，避免随文件数量增长。
        locks.retain(|_, value| value.strong_count() > 0);
        let lock = locks
            .get(&target)
            .and_then(Weak::upgrade)
            .unwrap_or_else(|| Arc::new(Mutex::new(())));
        locks.insert(target.clone(), Arc::downgrade(&lock));
        lock
    };
    let _guard = lock.lock().map_err(|_| WorkspaceError::TextFileConflict)?;
    let (original, metadata) = snapshot(&target)?;
    if version_of(&original) != input.expected_version {
        return Err(WorkspaceError::TextFileConflict);
    }
    let parent = target.parent().ok_or(WorkspaceError::TextFileUnsupported)?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent)?;
    temporary.write_all(input.content.as_bytes())?;
    temporary
        .as_file()
        .set_permissions(metadata.permissions())?;
    temporary.as_file().sync_all()?;
    resolve_target(root, &input.path)?;
    let (latest, latest_metadata) = snapshot(&target)?;
    if latest != original || metadata.modified()? != latest_metadata.modified()? {
        return Err(WorkspaceError::TextFileConflict);
    }
    // tempfile 在同目录原子替换，失败或提前返回时自动清理临时文件，保留原文。
    let written_before = temporary.as_file().metadata()?;
    let written = temporary
        .persist(&target)
        .map_err(|error| WorkspaceError::Io(error.error))?;
    // 只有目标仍是本次写入的快照才附带缓存标记；外部改写后下一次打开必须重读。
    // 保存已完成，附加缓存标记的失败不得把已成功写入误报为失败。
    let revision = (|| -> Result<Option<String>, WorkspaceError> {
        let written_after = written.metadata()?;
        let current = fs::symlink_metadata(&target)?;
        (written_before.len() == written_after.len()
            && written_before.modified()? == written_after.modified()?
            && revision_of(&written_after)? == revision_of(&current)?)
        .then(|| revision_of(&written_after))
        .transpose()
    })()
    .ok()
    .flatten();
    Ok(SavedTextFile {
        version: version_of(&input.content),
        revision,
    })
}

#[cfg(test)]
#[path = "text_files_tests.rs"]
mod tests;
