use std::{
    collections::{BTreeSet, HashMap, VecDeque},
    fs,
    io::Read,
    path::{Path, PathBuf},
    sync::{LazyLock, Mutex},
    time::SystemTime,
};

use sha2::{Digest, Sha256};
use tokio::sync::Semaphore;
use tokio_util::sync::CancellationToken;

use super::{git_read::GitChange, path_guard::WorkspaceError};

const MAX_CACHE_FILES: usize = 16_384;
static CACHE: LazyLock<Mutex<FingerprintCache>> = LazyLock::new(Mutex::default);
static HASH_SLOTS: Semaphore = Semaphore::const_new(2);

#[derive(Default)]
struct FingerprintCache {
    files: HashMap<PathBuf, (FileStamp, FileFingerprint)>,
    insertion_order: VecDeque<PathBuf>,
}

impl FingerprintCache {
    fn insert(&mut self, path: PathBuf, stamp: FileStamp, digest: FileFingerprint) {
        if !self.files.contains_key(&path) {
            // FIFO 有界淘汰，不保存文件内容，避免长期切换项目导致缓存无限增长。
            if self.files.len() == MAX_CACHE_FILES
                && let Some(oldest) = self.insertion_order.pop_front()
            {
                self.files.remove(&oldest);
            }
            self.insertion_order.push_back(path.clone());
        }
        self.files.insert(path, (stamp, digest));
    }
}

#[derive(PartialEq, Eq)]
struct FileStamp {
    len: u64,
    modified: SystemTime,
    created: Option<SystemTime>,
    permissions: fs::Permissions,
    #[cfg(unix)]
    identity: (u64, u64, i64, i64),
}

impl FileStamp {
    fn read(metadata: &fs::Metadata) -> Result<Self, WorkspaceError> {
        Ok(Self {
            len: metadata.len(),
            modified: metadata.modified()?,
            created: metadata.created().ok(),
            permissions: metadata.permissions(),
            #[cfg(unix)]
            identity: {
                use std::os::unix::fs::MetadataExt;
                // ctime 和 inode 捕获同尺寸覆盖、恢复 mtime 与原子替换。
                (
                    metadata.dev(),
                    metadata.ino(),
                    metadata.ctime(),
                    metadata.ctime_nsec(),
                )
            },
        })
    }
}

pub(super) async fn content_fingerprint(
    repo: &Path,
    unstaged: &mut [GitChange],
    gitlinks: &[String],
    strict: bool,
) -> Result<String, WorkspaceError> {
    // porcelain v2 已携带所有 index 对象与模式，外层直接纳入快照，无需再次启动 diff。
    let mut index = Vec::new();
    let mut paths: BTreeSet<String> = unstaged
        .iter()
        .flat_map(|change| std::iter::once(change.path.clone()).chain(change.original_path.clone()))
        .collect();
    if paths.iter().any(|path| path.ends_with('/')) {
        // 按记录扩展所有未跟踪路径，避免输出上限及目录参数超过操作系统 argv 限制。
        paths = super::git_stream::fold_records(
            repo,
            &["ls-files", "--others", "--exclude-standard", "-z"],
            paths,
            |paths, record| {
                paths.insert(
                    super::git_protocol::path_text(&record[..record.len() - 1])?.to_owned(),
                );
                Ok(())
            },
        )
        .await?;
    }
    let gitlink_paths: BTreeSet<_> = paths
        .iter()
        .filter(|path| path.ends_with('/'))
        .chain(gitlinks)
        .collect();
    for relative in gitlink_paths {
        let path = repo.join(relative);
        if tokio::fs::try_exists(path.join(".git")).await? {
            // gitlink 提交的是子仓库 HEAD；仅哈希目录类型会漏掉连续两次子模块提交。
            let head = super::git_protocol::read_complete(
                &path,
                &["rev-parse", "--revs-only", "HEAD"],
                "gitlink HEAD",
                256,
            )
            .await?;
            index.extend_from_slice(relative.as_bytes());
            index.push(0);
            index.extend_from_slice(&head);
        }
    }
    // 未跟踪内容已经为快照读取，顺便统计行数，避免另起进程或重复读取大文件。
    let mut additions: HashMap<String, usize> = unstaged
        .iter()
        .filter(|change| change.kind == "create")
        .map(|change| (change.path.clone(), 0))
        .collect();
    let repo = repo.to_owned();
    let cancellation = CancellationToken::new();
    // 外层 future 被丢弃时通知阻塞线程；abort 本身无法终止已启动的 spawn_blocking。
    let _cancel_on_drop = cancellation.clone().drop_guard();
    // 在异步侧等待配额，避免刷新风暴占满阻塞线程池。
    let permit = HASH_SLOTS
        .acquire()
        .await
        .map_err(|_| WorkspaceError::InvalidPath)?;
    let (fingerprint, additions) = tokio::task::spawn_blocking(move || {
        let _permit = permit;
        let mut hasher = Sha256::new();
        hasher.update(index);
        let mut buffer = [0_u8; 64 * 1024];
        for relative in paths {
            check_cancelled(&cancellation)?;
            hasher.update([0]);
            hasher.update(relative.as_bytes());
            hasher.update([0]);
            let path = repo.join(&relative);
            let metadata = match fs::symlink_metadata(&path) {
                Ok(metadata) => metadata,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    hasher.update(b"missing");
                    continue;
                }
                Err(error) => return Err(error.into()),
            };
            let mut lines = 0;
            if metadata.is_symlink() {
                // Git 保存链接目标文本，不能跟随链接读取项目外文件。
                hasher.update(b"symlink");
                let target = fs::read_link(path)?;
                let bytes = target.as_os_str().as_encoded_bytes();
                hasher.update(bytes);
                let mut counter = LineCounter::default();
                counter.update(bytes);
                lines = counter.lines();
            } else if metadata.is_file() {
                if !fs::canonicalize(&path)?.starts_with(&repo) {
                    return Err(WorkspaceError::InvalidPath);
                }
                hasher.update(b"file");
                let fingerprint =
                    file_fingerprint(&path, &metadata, strict, &cancellation, &mut buffer)?;
                hasher.update(fingerprint.digest);
                lines = fingerprint.lines;
            } else if metadata.is_dir() {
                hasher.update(b"directory");
            } else {
                return Err(WorkspaceError::InvalidPath);
            }
            if let Some(count) = additions.get_mut(&relative) {
                *count += lines;
            } else {
                // porcelain 将未跟踪目录聚合成一条，内部文件累加到最近的目录条目。
                let mut parent = relative.as_str();
                while let Some(separator) = parent.rfind('/') {
                    if let Some(count) = additions.get_mut(&relative[..=separator]) {
                        *count += lines;
                        break;
                    }
                    parent = &relative[..separator];
                }
            }
        }
        check_cancelled(&cancellation)?;
        Ok((
            crate::encoding::encode_lower_hex(hasher.finalize()),
            additions,
        ))
    })
    .await
    .map_err(|_| WorkspaceError::InvalidPath)??;
    for change in unstaged {
        if let Some(count) = additions.get(&change.path) {
            change.stats.additions = *count;
        }
    }
    Ok(fingerprint)
}

fn file_fingerprint(
    path: &Path,
    metadata: &fs::Metadata,
    strict: bool,
    cancellation: &CancellationToken,
    buffer: &mut [u8],
) -> Result<FileFingerprint, WorkspaceError> {
    let stamp = FileStamp::read(metadata)?;
    // 元数据仅用于刷新缓存失效；写入前必须重新读取全部内容，不能信任缓存。
    if !strict
        && let Some((cached_stamp, digest)) = CACHE
            .lock()
            .map_err(|_| WorkspaceError::InvalidPath)?
            .files
            .get(path)
        && *cached_stamp == stamp
    {
        return Ok(*digest);
    }
    let mut file = fs::File::open(path)?;
    let digest = hash_reader(&mut file, cancellation, buffer, path)?;
    // 读取期间发生覆盖或替换时拒绝快照，避免把混合内容存入缓存。
    if stamp != FileStamp::read(&file.metadata()?)?
        || stamp != FileStamp::read(&fs::symlink_metadata(path)?)?
    {
        return Err(WorkspaceError::SnapshotMismatch);
    }
    check_cancelled(cancellation)?;
    CACHE
        .lock()
        .map_err(|_| WorkspaceError::InvalidPath)?
        .insert(path.to_owned(), stamp, digest);
    Ok(digest)
}

fn hash_reader(
    reader: &mut impl Read,
    cancellation: &CancellationToken,
    buffer: &mut [u8],
    _path: &Path,
) -> Result<FileFingerprint, WorkspaceError> {
    let mut hasher = Sha256::new();
    let mut counter = LineCounter::default();
    loop {
        check_cancelled(cancellation)?;
        let count = reader.read(buffer)?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
        counter.update(&buffer[..count]);
        #[cfg(test)]
        tests::record_read(_path, count);
    }
    Ok(FileFingerprint {
        digest: hasher.finalize().into(),
        lines: counter.lines(),
    })
}

#[derive(Clone, Copy)]
struct FileFingerprint {
    digest: [u8; 32],
    lines: usize,
}

#[derive(Default)]
struct LineCounter {
    bytes: usize,
    newlines: usize,
    last: Option<u8>,
    binary: bool,
}

impl LineCounter {
    fn update(&mut self, bytes: &[u8]) {
        // 与 Git 默认二进制探测一致，仅检查前 8000 字节；末尾无换行仍计一行。
        let probe = 8000_usize.saturating_sub(self.bytes).min(bytes.len());
        self.binary |= bytes[..probe].contains(&0);
        self.bytes = self.bytes.saturating_add(bytes.len());
        if !self.binary {
            self.newlines += bytes.iter().filter(|byte| **byte == b'\n').count();
        }
        if let Some(last) = bytes.last() {
            self.last = Some(*last);
        }
    }

    fn lines(&self) -> usize {
        if self.binary {
            0
        } else {
            self.newlines + usize::from(self.last.is_some_and(|last| last != b'\n'))
        }
    }
}

fn check_cancelled(cancellation: &CancellationToken) -> Result<(), WorkspaceError> {
    if cancellation.is_cancelled() {
        return Err(
            std::io::Error::new(std::io::ErrorKind::Interrupted, "Git snapshot cancelled").into(),
        );
    }
    Ok(())
}

#[cfg(test)]
#[path = "git_snapshot_tests.rs"]
mod tests;
