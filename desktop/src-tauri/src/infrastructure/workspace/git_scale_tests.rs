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
