use std::{fs, time::SystemTime};

use super::*;

#[tokio::test]
async fn file_search_should_respect_project_ignore_rules() {
    let root = test_root("ignore");
    fs::create_dir_all(root.join("src")).unwrap();
    fs::create_dir_all(root.join("ignored")).unwrap();
    fs::create_dir_all(root.join(".hidden")).unwrap();
    fs::write(root.join(".gitignore"), "ignored/\n").unwrap();
    fs::write(root.join("src/visible-match.rs"), "").unwrap();
    fs::write(root.join("ignored/ignored-match.rs"), "").unwrap();
    fs::write(root.join(".hidden/hidden-match.rs"), "").unwrap();
    let root = fs::canonicalize(root).unwrap();
    let search = ProjectFileSearch::default();

    let page = search
        .search(&root, "root-a", "match", "session-a")
        .await
        .unwrap();

    assert_eq!(page.data.len(), 1);
    assert_eq!(page.data[0].path, "src/visible-match.rs");
    assert_eq!(page.data[0].root_id, "root-a");
    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn file_search_should_reuse_and_invalidate_the_project_index() {
    let root = test_root("cache");
    fs::create_dir_all(root.join("src")).unwrap();
    fs::write(root.join("src/first.rs"), "").unwrap();
    let root = fs::canonicalize(root).unwrap();
    let search = ProjectFileSearch::default();
    search
        .search(&root, "root-a", "first", "session-a")
        .await
        .unwrap();
    fs::write(root.join("src/second.rs"), "").unwrap();

    let cached = search
        .search(&root, "root-a", "second", "session-b")
        .await
        .unwrap();
    search.invalidate(&root);
    let refreshed = search
        .search(&root, "root-a", "second", "session-c")
        .await
        .unwrap();

    assert!(cached.data.is_empty());
    assert_eq!(refreshed.data[0].path, "src/second.rs");
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn starting_a_new_query_should_cancel_the_previous_session_token() {
    let search = ProjectFileSearch::default();
    let previous = search.start_session("session-a").unwrap();

    let current = search.start_session("session-a").unwrap();

    assert!(previous.is_cancelled());
    assert!(!current.is_cancelled());
}

#[test]
fn stopping_a_query_should_set_its_cancellation_token() {
    let search = ProjectFileSearch::default();
    let cancellation = search.start_session("session-a").unwrap();

    search.cancel("session-a");

    assert!(cancellation.is_cancelled());
}

#[test]
fn project_index_cache_should_remain_bounded() {
    let search = ProjectFileSearch::default();

    for index in 0..=MAX_CACHED_PROJECTS {
        search.store_index(PathBuf::from(format!("/project-{index}")), Arc::from([]));
    }

    assert_eq!(read_lock(&search.indexes).len(), MAX_CACHED_PROJECTS);
}

#[tokio::test]
async fn dropped_search_should_cancel_worker_and_release_session() {
    let root = test_root("dropped");
    fs::create_dir_all(&root).unwrap();
    let search = ProjectFileSearch::default();
    let mut pending = Box::pin(search.search(&root, "root", "", "cancelled"));
    tokio::select! { biased; _ = &mut pending => panic!("worker must yield"), _ = std::future::ready(()) => {} }
    drop(pending);
    assert!(mutex_lock(&search.sessions).is_empty());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn oversized_index_should_not_remain_cached() {
    let search = ProjectFileSearch::default();
    let file = IndexedFile {
        name: String::new(),
        path: "x".repeat(17 * 1024 * 1024),
        lower_path: String::new(),
    };
    search.store_index(PathBuf::from("/oversized"), Arc::from([file]));
    assert!(search.cached_index(Path::new("/oversized")).is_none());
}

fn test_root(label: &str) -> PathBuf {
    let unique = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir().join(format!("codeagent-search-{label}-{unique}"))
}

#[test]
fn cache_should_enforce_total_retained_bytes() {
    let search = ProjectFileSearch::default();
    for index in 0..4 {
        let file = IndexedFile {
            name: String::new(),
            path: "x".repeat(10 * 1024 * 1024),
            lower_path: String::new(),
        };
        search.store_index(PathBuf::from(format!("/bytes-{index}")), Arc::from([file]));
    }
    assert!(
        read_lock(&search.indexes)
            .values()
            .map(|entry| entry.bytes)
            .sum::<usize>()
            <= MAX_CACHE_BYTES
    );
    assert!(search.cached_index(Path::new("/bytes-0")).is_none());
}

#[test]
fn oversized_scan_should_find_late_matches_with_bounded_results() {
    let root = test_root("fallback");
    fs::create_dir_all(&root).unwrap();
    for index in 0..100 {
        fs::write(root.join(format!("match-{index:03}.txt")), "").unwrap();
    }
    fs::write(root.join("zzz-target.txt"), "").unwrap();
    let token = CancellationToken::new();
    let result = scan(&root, "target", "root", &token, 1).unwrap();
    assert!(result.index.is_none());
    assert_eq!(result.data[0].path, "zzz-target.txt");
    let result = scan(&root, "match", "root", &token, 1).unwrap();
    assert_eq!(result.data.len(), MAX_SEARCH_RESULTS);
    assert_eq!(result.data[0].path, "match-000.txt");
    assert_eq!(result.data[49].path, "match-049.txt");
    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn cancelled_waiter_should_not_consume_worker_capacity() {
    let search = ProjectFileSearch::default();
    let permits = Arc::clone(&search.slots)
        .acquire_many_owned(2)
        .await
        .unwrap();
    let mut pending = Box::pin(search.search(Path::new("/unused"), "root", "", "waiting"));
    tokio::select! { biased; _ = &mut pending => panic!("worker must wait"), _ = std::future::ready(()) => {} }
    search.cancel("waiting");
    let result = tokio::time::timeout(Duration::from_secs(1), pending)
        .await
        .unwrap()
        .unwrap();
    assert!(result.data.is_empty());
    assert!(mutex_lock(&search.sessions).is_empty());
    drop(permits);
    assert_eq!(search.slots.available_permits(), 2);
}

#[tokio::test]
async fn concurrent_queries_should_reuse_one_directory_index() {
    let root = test_root("concurrent");
    fs::create_dir_all(&root).unwrap();
    fs::write(root.join("file.txt"), "").unwrap();
    let search = ProjectFileSearch::default();
    let (first, second) = tokio::join!(
        search.search(&root, "root", "file", "first"),
        search.search(&root, "root", "file", "second")
    );
    assert_eq!(first.unwrap().data.len(), 1);
    assert_eq!(second.unwrap().data.len(), 1);
    assert_eq!(search.build_count.load(Ordering::Relaxed), 1);
    fs::remove_dir_all(root).unwrap();
}
