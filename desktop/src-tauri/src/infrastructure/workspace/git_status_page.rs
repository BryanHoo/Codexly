//! UI 每次仅接收一页元数据；后续页复用有界短期快照，写操作仍重新严格校验。
use super::{
    git_models::{GitChange, GitStatus},
    git_read::get_git_status_with_stats,
    path_guard::WorkspaceError,
};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, LazyLock, Mutex},
    time::{Duration, Instant},
};

const PAGE_SIZE: usize = 1_000;
const CACHE_PATH_BYTES: usize = 32 * 1024 * 1024;
const CACHE_TTL: Duration = Duration::from_secs(60);
static CACHE: LazyLock<Mutex<Option<CachedStatus>>> = LazyLock::new(Mutex::default);

struct CachedChange {
    path: Arc<str>,
    kind: &'static str,
    stats: crate::domain::file_change::FileChangeStats,
}
struct CachedStatus {
    root: PathBuf,
    repository: Option<String>,
    created: Instant,
    header: GitStatus,
    staged: Vec<CachedChange>,
    unstaged: Vec<CachedChange>,
}

pub async fn get_git_status_page(
    root: &Path,
    repository: Option<&str>,
    cursor: Option<&str>,
) -> Result<GitStatus, WorkspaceError> {
    let cursor = cursor
        .and_then(|value| value.split_once(':'))
        .and_then(|(snapshot, offset)| {
            offset
                .parse::<usize>()
                .ok()
                .map(|offset| (snapshot, offset))
        });
    if let Some((snapshot, offset)) = cursor
        && let Some(cached) = CACHE
            .lock()
            .map_err(|_| WorkspaceError::InvalidPath)?
            .as_ref()
        && cached.root == root
        && cached.repository.as_deref() == repository
        && cached.header.snapshot == snapshot
        && cached.created.elapsed() < CACHE_TTL
    {
        return Ok(cached.page(offset));
    }

    // 游标失效时返回新快照首页；快照未变但缓存已淘汰时仍从原位置继续。
    let status = get_git_status_with_stats(root, repository).await?;
    let offset = cursor
        .filter(|(snapshot, _)| *snapshot == status.snapshot)
        .map_or(0, |(_, offset)| offset);
    let result = page(&status, offset);
    if let Some(cached) = CachedStatus::new(root, repository, status) {
        *CACHE.lock().map_err(|_| WorkspaceError::InvalidPath)? = Some(cached);
        // 无后续请求也须释放大清单；更新的快照由自己的到期任务负责清理。
        tokio::spawn(async {
            tokio::time::sleep(CACHE_TTL).await;
            if let Ok(mut cache) = CACHE.lock()
                && cache
                    .as_ref()
                    .is_some_and(|entry| entry.created.elapsed() >= CACHE_TTL)
            {
                *cache = None;
            }
        });
    }
    Ok(result)
}

impl CachedStatus {
    fn new(root: &Path, repository: Option<&str>, mut status: GitStatus) -> Option<Self> {
        let total = status.staged.len() + status.unstaged.len();
        let mut bytes = total.checked_mul(std::mem::size_of::<CachedChange>())?;
        if bytes > CACHE_PATH_BYTES {
            return None;
        }
        let mut paths: HashMap<&str, Arc<str>> = HashMap::new();
        let staged = compact(&status.staged, &mut paths, &mut bytes)?;
        let unstaged = compact(&status.unstaged, &mut paths, &mut bytes)?;
        drop(paths);
        status.staged = Vec::new();
        status.unstaged = Vec::new();
        Some(Self {
            root: root.to_owned(),
            repository: repository.map(str::to_owned),
            created: Instant::now(),
            header: status,
            staged,
            unstaged,
        })
    }

    fn page(&self, offset: usize) -> GitStatus {
        let mut result = self.header.clone();
        let staged_count = self.staged.len();
        let total = staged_count + self.unstaged.len();
        let end = offset.saturating_add(PAGE_SIZE).min(total);
        let expand = |change: &CachedChange| GitChange {
            path: change.path.to_string(),
            kind: change.kind,
            diff: String::new(),
            stats: change.stats,
            original_path: None,
            truncated: false,
        };
        result.staged = self
            .staged
            .iter()
            .skip(offset)
            .take(PAGE_SIZE)
            .map(expand)
            .collect();
        result.unstaged = self
            .unstaged
            .iter()
            .skip(offset.saturating_sub(staged_count))
            .take(end.saturating_sub(offset.max(staged_count)))
            .map(expand)
            .collect();
        result.next_cursor = (end < total).then(|| format!("{}:{end}", result.snapshot));
        result.total_changes = Some(total);
        result
    }
}

fn page(status: &GitStatus, offset: usize) -> GitStatus {
    let staged_count = status.staged.len();
    let total = staged_count + status.unstaged.len();
    let end = offset.saturating_add(PAGE_SIZE).min(total);
    GitStatus {
        stats: status.stats,
        base_branches: status.base_branches.clone(),
        branch: status.branch.clone(),
        branches: status.branches.clone(),
        repository_mode: status.repository_mode,
        snapshot: status.snapshot.clone(),
        staged: status
            .staged
            .iter()
            .skip(offset)
            .take(PAGE_SIZE)
            .cloned()
            .collect(),
        unstaged: status
            .unstaged
            .iter()
            .skip(offset.saturating_sub(staged_count))
            .take(end.saturating_sub(offset.max(staged_count)))
            .cloned()
            .collect(),
        next_cursor: (end < total).then(|| format!("{}:{end}", status.snapshot)),
        total_changes: Some(total),
    }
}

fn compact<'a>(
    changes: &'a [GitChange],
    paths: &mut HashMap<&'a str, Arc<str>>,
    bytes: &mut usize,
) -> Option<Vec<CachedChange>> {
    let mut result = Vec::with_capacity(changes.len());
    for change in changes {
        // 同一路径的 staged/unstaged 共用字符串，省去补丁占位与写入专用旧路径。
        let path = paths.entry(change.path.as_str()).or_insert_with(|| {
            *bytes += change.path.len() + 3 * std::mem::size_of::<usize>();
            Arc::from(change.path.as_str())
        });
        if *bytes > CACHE_PATH_BYTES {
            return None;
        }
        result.push(CachedChange {
            path: Arc::clone(path),
            kind: change.kind,
            stats: change.stats,
        });
    }
    Some(result)
}
