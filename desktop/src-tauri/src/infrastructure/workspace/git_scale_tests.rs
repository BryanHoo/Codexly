use super::{get_git_status, git_integrity_tests::Repository};
use std::{
    io::Write,
    process::{Command, Stdio},
};

fn populate_index(repo: &Repository, count: usize) {
    let blob = Command::new("git")
        .args(["rev-parse", "HEAD:old.txt"])
        .current_dir(&repo.0)
        .output()
        .unwrap();
    assert!(blob.status.success());
    let oid = String::from_utf8(blob.stdout).unwrap();
    let mut child = Command::new("git")
        .args(["update-index", "--index-info"])
        .current_dir(&repo.0)
        .stdin(Stdio::piped())
        .spawn()
        .unwrap();
    let mut input = child.stdin.take().unwrap();
    for n in 0..count {
        writeln!(
            input,
            "100644 {}\t{}-{n:06}.txt",
            oid.trim(),
            "large".repeat(32)
        )
        .unwrap();
    }
    drop(input);
    assert!(child.wait().unwrap().success());
}

#[tokio::test]
async fn large_status_should_not_fail_when_metadata_exceeds_two_megabytes() {
    let repo = Repository::new();
    populate_index(&repo, 10_000);
    let status = get_git_status(&repo.0, None, false).await.unwrap();
    assert_eq!(status.staged.len(), 10_000);
    assert_eq!(status.unstaged.len(), 10_000);
    assert!(status.staged.iter().all(|change| change.diff.is_empty()));
}

#[tokio::test]
async fn large_selection_should_commit_more_than_five_hundred_paths() {
    let repo = Repository::new();
    populate_index(&repo, 600);
    let status = get_git_status(&repo.0, None, false).await.unwrap();
    let paths: Vec<_> = status
        .staged
        .iter()
        .map(|change| change.path.clone())
        .collect();
    super::commit_changes(
        &repo.0,
        None,
        &paths,
        "large selection",
        "commit",
        &status.snapshot,
    )
    .await
    .unwrap();
    let after = get_git_status(&repo.0, None, false).await.unwrap();
    assert!(after.staged.is_empty());
    assert_eq!(after.unstaged.len(), 600);
}

#[tokio::test]
async fn large_status_pages_should_cover_all_entries_without_duplicates() {
    let repo = Repository::new();
    populate_index(&repo, 2_100);
    let mut cursor = None;
    let mut paths = std::collections::HashSet::new();
    let mut snapshot = None;
    loop {
        let page = super::get_git_status_page(&repo.0, None, cursor.as_deref())
            .await
            .unwrap();
        assert!(page.staged.len() + page.unstaged.len() <= 1_000);
        assert_eq!(page.total_changes, Some(4_200));
        if let Some(snapshot) = &snapshot {
            assert_eq!(&page.snapshot, snapshot);
        } else {
            snapshot = Some(page.snapshot.clone());
        }
        for change in page.staged {
            assert!(paths.insert((true, change.path)));
        }
        for change in page.unstaged {
            assert!(paths.insert((false, change.path)));
        }
        cursor = page.next_cursor;
        if cursor.is_none() {
            break;
        }
    }
    assert_eq!(paths.len(), 4_200);
}

#[tokio::test]
async fn single_file_diff_should_not_spend_budget_on_other_files() {
    let repo = Repository::new();
    std::fs::write(
        repo.0.join("aaa.txt"),
        "unrelated large file\n".repeat(150_000),
    )
    .unwrap();
    std::fs::write(repo.0.join("zzz[1].txt"), "selected content\n").unwrap();
    assert!(
        Command::new("git")
            .args(["add", "."])
            .current_dir(&repo.0)
            .status()
            .unwrap()
            .success()
    );
    let status = super::get_git_file_status(&repo.0, None, "zzz[1].txt", true)
        .await
        .unwrap();
    assert_eq!(status.staged.len(), 1);
    assert!(status.staged[0].diff.contains("selected content"));
    assert!(!status.staged[0].truncated);
}

#[tokio::test]
#[ignore = "large repository release baseline"]
async fn performance_baseline_large_git_status_pages() {
    for count in [10_000, 50_000, 100_000] {
        let repo = Repository::new();
        populate_index(&repo, count);
        let start = std::time::Instant::now();
        let first = super::get_git_status_page(&repo.0, None, None)
            .await
            .unwrap();
        let first_ms = start.elapsed().as_secs_f64() * 1_000.0;
        let bytes = serde_json::to_vec(&first).unwrap().len();
        let start = std::time::Instant::now();
        let second = super::get_git_status_page(&repo.0, None, first.next_cursor.as_deref())
            .await
            .unwrap();
        println!(
            "git-scale files={count} first_ms={first_ms:.3} next_ms={:.3} ipc_bytes={bytes}",
            start.elapsed().as_secs_f64() * 1_000.0
        );
        assert_eq!(first.staged.len(), 1_000);
        assert_eq!(second.staged.len(), 1_000);
        assert!(bytes < 400_000);
    }
}

#[tokio::test]
async fn metadata_pages_should_retain_line_counts_without_patch_bodies() {
    let repo = Repository::new();
    populate_index(&repo, 1_100);
    let first = super::get_git_status_page(&repo.0, None, None)
        .await
        .unwrap();
    assert_eq!(
        first.stats,
        Some(crate::domain::file_change::FileChangeStats {
            additions: 1_100,
            removals: 1_100
        })
    );
    assert_eq!(first.staged[0].stats.additions, 1);
    assert!(first.staged.iter().all(|change| change.diff.is_empty()));
    let second = super::get_git_status_page(&repo.0, None, first.next_cursor.as_deref())
        .await
        .unwrap();
    assert_eq!(second.stats, first.stats);
    assert_eq!(second.staged[0].stats.additions, 1);
    assert_eq!(second.unstaged[0].stats.removals, 1);
}

#[tokio::test]
async fn alternating_worktrees_should_keep_both_cursor_snapshots() {
    let repo = Repository::new();
    let linked = repo.0.join("linked");
    assert!(
        Command::new("git")
            .args(["worktree", "add", "-b", "linked", "linked"])
            .current_dir(&repo.0)
            .status()
            .unwrap()
            .success()
    );
    std::fs::write(repo.0.join(".git/info/exclude"), "/linked/\n").unwrap();
    for root in [&repo.0, &linked] {
        for index in 0..1_001 {
            std::fs::write(root.join(format!("new-{index:04}.txt")), "first\n").unwrap();
        }
    }
    let first = super::get_git_status_page(&repo.0, None, None)
        .await
        .unwrap();
    let other = super::get_git_status_page(&linked, None, None)
        .await
        .unwrap();
    assert_ne!(first.snapshot, other.snapshot);
    std::fs::write(repo.0.join("new-1000.txt"), "changed\nmore\n").unwrap();

    let next = super::get_git_status_page(&repo.0, None, first.next_cursor.as_deref())
        .await
        .unwrap();
    assert_eq!(next.snapshot, first.snapshot);
    assert_eq!(next.unstaged.len(), 1);
    assert_eq!(next.unstaged[0].stats.additions, 1);

    // 首页重新验证内容，旧游标页仍保持同一次浏览看到的快照。
    let refreshed = super::get_git_status_page(&repo.0, None, None)
        .await
        .unwrap();
    assert_ne!(refreshed.snapshot, first.snapshot);
    assert_eq!(refreshed.stats.unwrap().additions, 1_002);
}

#[tokio::test]
#[ignore = "isolated Git status refresh performance benchmark"]
async fn performance_baseline_git_status_refresh() {
    let Some(root) = std::env::var_os("CODEXLY_GIT_BENCH_ROOT") else {
        return;
    };
    let root = std::path::PathBuf::from(root);
    for (label, root, linked) in [
        ("index", root.join("index"), None),
        ("untracked", root.join("untracked"), None),
        ("alternate", root.join("index"), Some(root.join("linked"))),
    ] {
        let first = super::get_git_status_page(&root, None, None).await.unwrap();
        let other = match &linked {
            Some(path) => Some(super::get_git_status_page(path, None, None).await.unwrap()),
            None => None,
        };
        let mut samples = Vec::new();
        for sample in 0..25 {
            let start = std::time::Instant::now();
            if let (Some(path), Some(other)) = (&linked, &other) {
                let (target, initial) = if sample % 2 == 0 {
                    (&root, &first)
                } else {
                    (path, other)
                };
                let page = super::get_git_status_page(target, None, initial.next_cursor.as_deref())
                    .await
                    .unwrap();
                assert_eq!(page.snapshot, initial.snapshot);
            } else {
                let page = super::get_git_status_page(&root, None, None).await.unwrap();
                assert_eq!(page.snapshot, first.snapshot);
            }
            samples.push(start.elapsed().as_secs_f64() * 1_000.0);
        }
        samples.sort_by(f64::total_cmp);
        println!(
            "git-status-refresh scenario={label} samples=25 p95_ms={:.3}",
            samples[23]
        );
    }
}
