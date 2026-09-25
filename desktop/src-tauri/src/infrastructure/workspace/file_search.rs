use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex, MutexGuard, RwLock, RwLockWriteGuard, Weak,
        atomic::{AtomicU64, Ordering},
    },
    time::{Duration, Instant},
};

use serde::Serialize;
use tokio::sync::{Mutex as AsyncMutex, Semaphore};
use tokio_util::sync::CancellationToken;

use super::{
    file_search_index::{IndexedFile, MAX_INDEX_BYTES, ScanResult, scan, search_index},
    path_guard::WorkspaceError,
};

const INDEX_CACHE_TTL: Duration = Duration::from_secs(5);
const MAX_CACHED_PROJECTS: usize = 8;
const MAX_CACHE_BYTES: usize = 32 * 1024 * 1024;
const MAX_SESSIONS: usize = 32;
pub(super) const MAX_SEARCH_RESULTS: usize = 50;

#[derive(Debug, Serialize)]
pub struct FileSearchPage {
    pub data: Vec<FileSearchEntry>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSearchEntry {
    pub name: String,
    pub path: String,
    pub root_id: String,
    pub root_path: String,
}

struct CachedIndex {
    created_at: Instant,
    files: Arc<[IndexedFile]>,
    bytes: usize,
}

pub struct ProjectFileSearch {
    indexes: RwLock<HashMap<PathBuf, CachedIndex>>,
    sessions: Mutex<HashMap<String, Arc<CancellationToken>>>,
    roots: Mutex<HashMap<PathBuf, Weak<AsyncMutex<()>>>>,
    slots: Arc<Semaphore>,
    generation: AtomicU64,
    #[cfg(test)]
    build_count: AtomicU64,
}

impl Default for ProjectFileSearch {
    fn default() -> Self {
        Self {
            indexes: RwLock::default(),
            sessions: Mutex::default(),
            roots: Mutex::default(),
            slots: Arc::new(Semaphore::new(2)),
            generation: AtomicU64::new(0),
            #[cfg(test)]
            build_count: AtomicU64::new(0),
        }
    }
}

/// Future 取消、错误及正常结束均撤销会话；阻塞线程通过 token 协作退出。
struct SearchSession<'a> {
    search: &'a ProjectFileSearch,
    id: &'a str,
    token: Arc<CancellationToken>,
}
impl Drop for SearchSession<'_> {
    fn drop(&mut self) {
        self.token.cancel();
        self.search.finish_session(self.id, &self.token);
    }
}

impl ProjectFileSearch {
    pub async fn search(
        &self,
        root: &Path,
        root_id: &str,
        query: &str,
        session_id: &str,
    ) -> Result<FileSearchPage, WorkspaceError> {
        let token = self.start_session(session_id)?;
        let _session = SearchSession {
            search: self,
            id: session_id,
            token: Arc::clone(&token),
        };
        let root_lock = self.root_lock(root);
        let root_guard = tokio::select! {
            guard = root_lock.lock_owned() => guard,
            _ = token.cancelled() => return Ok(FileSearchPage { data: Vec::new() }),
        };
        // 同目录等待者在获得锁后复查缓存，禁止重复冷启动扫描。
        let cached = self.cached_index(root);
        let generation = self.generation.load(Ordering::Relaxed);
        let permit = tokio::select! {
            permit = Arc::clone(&self.slots).acquire_owned() => permit.map_err(|_| std::io::Error::other("file search is closed"))?,
            _ = token.cancelled() => return Ok(FileSearchPage { data: Vec::new() }),
        };
        #[cfg(test)]
        if cached.is_none() {
            self.build_count.fetch_add(1, Ordering::Relaxed);
        }
        let worker_root = root.to_owned();
        let query = query.trim().to_lowercase();
        let root_id = root_id.to_owned();
        let worker_token = Arc::clone(&token);
        let (result, _root_guard) = tokio::task::spawn_blocking(move || {
            // 资源租约跟随真实 worker，外层取消不能提前放行新的阻塞扫描。
            let _permit = permit;
            let result = match cached {
                Some(files) => Ok(ScanResult {
                    data: search_index(
                        &files,
                        &query,
                        &root_id,
                        &worker_root.to_string_lossy(),
                        &worker_token,
                    ),
                    index: None,
                }),
                None => scan(
                    &worker_root,
                    &query,
                    &root_id,
                    &worker_token,
                    MAX_INDEX_BYTES,
                ),
            };
            (result, root_guard)
        })
        .await
        .map_err(|_| std::io::Error::other("project file search task failed"))?;
        let result = result?;
        if token.is_cancelled() {
            return Ok(FileSearchPage { data: Vec::new() });
        }
        if let Some(files) = result.index {
            let mut indexes = write_lock(&self.indexes);
            // invalidate 与发布使用同一锁，旧扫描不得重新装入失效缓存。
            if self.generation.load(Ordering::Relaxed) == generation {
                store_index(&mut indexes, root.to_owned(), files);
            }
        }
        Ok(FileSearchPage { data: result.data })
    }

    pub fn cancel(&self, session_id: &str) {
        if let Some(token) = mutex_lock(&self.sessions).get(session_id) {
            token.cancel();
        }
    }

    pub fn invalidate(&self, root: &Path) {
        let mut indexes = write_lock(&self.indexes);
        self.generation.fetch_add(1, Ordering::Relaxed);
        indexes.remove(root);
    }

    fn root_lock(&self, root: &Path) -> Arc<AsyncMutex<()>> {
        let mut roots = mutex_lock(&self.roots);
        roots.retain(|_, lock| lock.strong_count() > 0);
        if let Some(lock) = roots.get(root).and_then(Weak::upgrade) {
            return lock;
        }
        let lock = Arc::new(AsyncMutex::new(()));
        roots.insert(root.to_owned(), Arc::downgrade(&lock));
        lock
    }

    fn start_session(&self, id: &str) -> Result<Arc<CancellationToken>, WorkspaceError> {
        let mut sessions = mutex_lock(&self.sessions);
        if id.len() > 1024 || (sessions.len() >= MAX_SESSIONS && !sessions.contains_key(id)) {
            return Err(std::io::Error::new(
                std::io::ErrorKind::WouldBlock,
                "file search capacity exceeded",
            )
            .into());
        }
        let token = Arc::new(CancellationToken::new());
        if let Some(previous) = sessions.insert(id.to_owned(), Arc::clone(&token)) {
            previous.cancel();
        }
        Ok(token)
    }

    fn finish_session(&self, id: &str, token: &Arc<CancellationToken>) {
        let mut sessions = mutex_lock(&self.sessions);
        if sessions
            .get(id)
            .is_some_and(|current| Arc::ptr_eq(current, token))
        {
            sessions.remove(id);
        }
    }

    fn cached_index(&self, root: &Path) -> Option<Arc<[IndexedFile]>> {
        // 查询顺带释放过期数据，无后台轮询；空闲保留仍受总字节预算约束。
        let mut indexes = write_lock(&self.indexes);
        indexes.retain(|_, cached| cached.created_at.elapsed() < INDEX_CACHE_TTL);
        indexes.get(root).map(|cached| Arc::clone(&cached.files))
    }

    #[cfg(test)]
    pub(super) fn retained_index_bytes(&self) -> usize {
        read_lock(&self.indexes)
            .values()
            .map(|cached| cached.bytes)
            .sum()
    }

    #[cfg(test)]
    fn store_index(&self, root: PathBuf, files: Arc<[IndexedFile]>) {
        store_index(&mut write_lock(&self.indexes), root, files);
    }
}

fn store_index(
    indexes: &mut HashMap<PathBuf, CachedIndex>,
    root: PathBuf,
    files: Arc<[IndexedFile]>,
) {
    indexes.remove(&root);
    let bytes = files.iter().map(IndexedFile::retained_bytes).sum::<usize>();
    if bytes > MAX_INDEX_BYTES {
        return;
    }
    indexes.retain(|_, cached| cached.created_at.elapsed() < INDEX_CACHE_TTL);
    let mut retained = indexes.values().map(|cached| cached.bytes).sum::<usize>();
    while indexes.len() >= MAX_CACHED_PROJECTS || retained.saturating_add(bytes) > MAX_CACHE_BYTES {
        let Some(oldest) = indexes
            .iter()
            .min_by_key(|(_, cached)| cached.created_at)
            .map(|(root, _)| root.clone())
        else {
            break;
        };
        if let Some(removed) = indexes.remove(&oldest) {
            retained -= removed.bytes;
        }
    }
    indexes.insert(
        root,
        CachedIndex {
            created_at: Instant::now(),
            files,
            bytes,
        },
    );
}

fn mutex_lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|error| error.into_inner())
}
#[cfg(test)]
fn read_lock<T>(lock: &RwLock<T>) -> std::sync::RwLockReadGuard<'_, T> {
    lock.read().unwrap_or_else(|error| error.into_inner())
}
fn write_lock<T>(lock: &RwLock<T>) -> RwLockWriteGuard<'_, T> {
    lock.write().unwrap_or_else(|error| error.into_inner())
}

#[cfg(test)]
#[path = "file_search_tests.rs"]
mod tests;
