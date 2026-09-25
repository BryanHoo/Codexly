use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{LazyLock, Mutex},
};

use super::*;

static READS: LazyLock<Mutex<HashMap<PathBuf, usize>>> = LazyLock::new(Mutex::default);
type ReadGate = (
    tokio::sync::oneshot::Sender<()>,
    std::sync::mpsc::Receiver<()>,
);
static READ_GATES: LazyLock<Mutex<HashMap<PathBuf, ReadGate>>> = LazyLock::new(Mutex::default);

pub(super) fn record_read(path: &Path, count: usize) {
    *READS.lock().unwrap().entry(path.to_owned()).or_default() += count;
    let gate = READ_GATES.lock().unwrap().remove(path);
    if let Some((started, release)) = gate {
        let _ = started.send(());
        release.recv().unwrap();
    }
}

#[tokio::test]
async fn refresh_should_invalidate_only_changed_file_and_strict_validation_should_reread() {
    let repo = super::super::git_integrity_tests::Repository::new();
    let changed = repo.0.join("changed.txt");
    let unchanged = repo.0.join("unchanged.txt");
    fs::write(&changed, "one").unwrap();
    fs::write(&unchanged, "stable").unwrap();
    let first = super::super::get_git_status(&repo.0, None, false)
        .await
        .unwrap();
    fs::write(&changed, "two").unwrap();
    let second = super::super::get_git_status(&repo.0, None, false)
        .await
        .unwrap();
    assert_ne!(first.snapshot, second.snapshot);
    assert_eq!(bytes_read(&changed), 6);
    assert_eq!(bytes_read(&unchanged), 6);
    super::super::git_write::validate_snapshot(&repo.0, None, &second.snapshot)
        .await
        .unwrap();
    assert_eq!(bytes_read(&changed), 9);
    assert_eq!(bytes_read(&unchanged), 12);
}

#[tokio::test]
async fn aborting_refresh_should_stop_started_hash_worker_after_current_chunk() {
    let repo = super::super::git_integrity_tests::Repository::new();
    let path = repo.0.join("cancel.bin");
    fs::write(&path, vec![42; 2 * 1024 * 1024]).unwrap();
    let (started_tx, started_rx) = tokio::sync::oneshot::channel();
    let (release_tx, release_rx) = std::sync::mpsc::channel();
    READ_GATES
        .lock()
        .unwrap()
        .insert(path.clone(), (started_tx, release_rx));
    let root = repo.0.clone();
    let request =
        tokio::spawn(async move { super::super::get_git_status(&root, None, false).await });
    started_rx.await.unwrap();
    request.abort();
    assert!(request.await.unwrap_err().is_cancelled());
    release_tx.send(()).unwrap();
    // 获取全部配额证明已启动的阻塞线程真正退出，不靠延时推断取消成功。
    let _idle = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        HASH_SLOTS.acquire_many(2),
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(bytes_read(&path), 64 * 1024);
    assert!(!CACHE.lock().unwrap().files.contains_key(&path));
}

#[tokio::test]
async fn strict_validation_should_reject_stale_digest_even_when_metadata_matches() {
    let repo = super::super::git_integrity_tests::Repository::new();
    let path = repo.0.join("stale.txt");
    fs::write(&path, "one").unwrap();
    let first = super::super::get_git_status(&repo.0, None, false)
        .await
        .unwrap();
    fs::write(&path, "two").unwrap();
    // 模拟文件系统元数据无法区分两次写入，证明写操作不依赖缓存命中是否可靠。
    CACHE.lock().unwrap().files.get_mut(&path).unwrap().0 =
        FileStamp::read(&fs::symlink_metadata(&path).unwrap()).unwrap();
    let result = super::super::git_write::validate_snapshot(&repo.0, None, &first.snapshot).await;
    assert!(matches!(result, Err(WorkspaceError::SnapshotMismatch)));
    assert_eq!(bytes_read(&path), 6);
}

fn bytes_read(path: &Path) -> usize {
    READS.lock().unwrap().get(path).copied().unwrap_or_default()
}

#[tokio::test]
async fn refresh_should_reuse_unchanged_large_untracked_file() {
    let repo = super::super::git_integrity_tests::Repository::new();
    let path = repo.0.join("large.bin");
    fs::write(&path, vec![42; 2 * 1024 * 1024]).unwrap();
    let first = super::super::get_git_status(&repo.0, None, false)
        .await
        .unwrap();
    let initial_reads = bytes_read(&path);
    assert_eq!(initial_reads, 2 * 1024 * 1024);
    let second = super::super::get_git_status(&repo.0, None, false)
        .await
        .unwrap();
    assert_eq!(first.snapshot, second.snapshot);
    assert_eq!(
        bytes_read(&path),
        initial_reads,
        "unchanged refresh must not reread file content"
    );
}
