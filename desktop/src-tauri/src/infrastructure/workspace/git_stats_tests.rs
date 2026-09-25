use std::{fs, path::Path, process::Command};

use super::{get_git_status_page, git_integrity_tests::Repository};
use crate::domain::file_change::FileChangeStats;

fn git(root: &Path, args: &[&str]) {
    let output = Command::new("git")
        .args(args)
        .current_dir(root)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
}

#[tokio::test]
async fn status_stats_should_cover_both_sides_and_untracked_directory_without_diffs() {
    let repo = Repository::new();
    fs::write(repo.0.join("old.txt"), "staged\nextra\n").unwrap();
    git(&repo.0, &["add", "old.txt"]);
    fs::write(repo.0.join("old.txt"), "worktree\nextra\nthird").unwrap();
    fs::create_dir_all(repo.0.join("new/nested")).unwrap();
    fs::write(repo.0.join("new/.gitignore"), "ignored.txt\n").unwrap();
    fs::write(repo.0.join("new/ignored.txt"), "ignored\n".repeat(50)).unwrap();
    fs::write(repo.0.join("new/nested/text.txt"), "one\ntwo").unwrap();
    fs::write(repo.0.join("binary.bin"), b"before\0after\n").unwrap();
    fs::write(repo.0.join("empty.txt"), "").unwrap();
    let page = get_git_status_page(&repo.0, None, None).await.unwrap();
    assert_eq!(
        page.stats,
        Some(FileChangeStats {
            additions: 7,
            removals: 2
        })
    );
    assert_eq!(
        page.staged[0].stats,
        FileChangeStats {
            additions: 2,
            removals: 1
        }
    );
    let changes: std::collections::HashMap<_, _> = page
        .unstaged
        .iter()
        .map(|change| (change.path.as_str(), change.stats))
        .collect();
    assert_eq!(
        changes["old.txt"],
        FileChangeStats {
            additions: 2,
            removals: 1
        }
    );
    assert_eq!(changes["new/"].additions, 3);
    assert_eq!(changes["binary.bin"].additions, 0);
    assert_eq!(changes["empty.txt"].additions, 0);
    assert!(
        page.staged
            .iter()
            .chain(&page.unstaged)
            .all(|change| change.diff.is_empty())
    );
    // 热缓存必须同时复用摘要与行数，而不是只缓存 hash 后丢失未跟踪行数。
    assert_eq!(
        get_git_status_page(&repo.0, None, None)
            .await
            .unwrap()
            .stats,
        page.stats
    );
}

#[tokio::test]
async fn status_stats_should_map_renamed_special_path() {
    let repo = Repository::new();
    let path = "new name [1].txt";
    git(&repo.0, &["config", "status.renames", "false"]);
    git(&repo.0, &["config", "diff.renames", "false"]);
    git(&repo.0, &["mv", "old.txt", path]);
    fs::write(repo.0.join(path), "baseline\nnew line\n").unwrap();
    git(&repo.0, &["add", "--", path]);
    let page = get_git_status_page(&repo.0, None, None).await.unwrap();
    assert_eq!(page.staged.len(), 1);
    assert_eq!(page.staged[0].path, path);
    assert_eq!(
        page.staged[0].stats,
        FileChangeStats {
            additions: 1,
            removals: 0
        }
    );
    assert_eq!(page.stats, Some(page.staged[0].stats));
}

#[tokio::test]
async fn status_stats_should_work_on_unborn_branch_and_not_truncate_large_file_counts() {
    let repo = Repository::new();
    git(&repo.0, &["checkout", "--orphan", "unborn"]);
    fs::write(repo.0.join("large.txt"), "line\n".repeat(150_000)).unwrap();
    git(&repo.0, &["add", "large.txt"]);
    let page = get_git_status_page(&repo.0, None, None).await.unwrap();
    assert_eq!(
        page.stats,
        Some(FileChangeStats {
            additions: 150_001,
            removals: 0
        })
    );
    assert!(serde_json::to_vec(&page).unwrap().len() < 2_000);
}

#[cfg(unix)]
#[tokio::test]
async fn status_stats_should_count_symlink_text_without_following_target() {
    let repo = Repository::new();
    std::os::unix::fs::symlink("/outside/nonexistent", repo.0.join("link")).unwrap();
    let page = get_git_status_page(&repo.0, None, None).await.unwrap();
    assert_eq!(
        page.stats,
        Some(FileChangeStats {
            additions: 1,
            removals: 0
        })
    );
}
