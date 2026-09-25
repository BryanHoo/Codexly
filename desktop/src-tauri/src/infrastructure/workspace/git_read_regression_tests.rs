use std::{fs, path::Path, process::Command};

use super::{get_commit_diff, get_git_history, get_git_status, git_integrity_tests::Repository};

fn git(root: &Path, args: &[&str]) -> String {
    let output = Command::new("git")
        .args(["-c", "commit.gpgsign=false"])
        .args(args)
        .current_dir(root)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout).unwrap().trim().to_owned()
}

#[tokio::test]
async fn git_read_should_preserve_stdout_prefix_when_truncated() {
    let repo = Repository::new();
    let content = (0..10_000)
        .map(|n| format!("line {n:05}\n"))
        .collect::<String>();
    fs::write(repo.0.join("large.txt"), &content).unwrap();
    git(&repo.0, &["add", "."]);
    git(&repo.0, &["commit", "-m", "large"]);
    let (output, truncated) =
        super::git_process::run_git(&repo.0, &["show", "HEAD:large.txt"], 1024)
            .await
            .unwrap();
    assert!(truncated);
    assert_eq!(output, content.as_bytes()[..1024]);
}

#[tokio::test]
async fn git_read_should_preserve_empty_and_control_character_commit_titles() {
    let repo = Repository::new();
    git(
        &repo.0,
        &["commit", "--allow-empty", "--allow-empty-message", "-m", ""],
    );
    git(
        &repo.0,
        &[
            "commit",
            "--allow-empty",
            "-m",
            "subject\u{1e}with\u{1f}separators",
        ],
    );
    let page = get_git_history(&repo.0, None, None).await.unwrap();
    assert_eq!(page.commits[0].title, "subject\u{1e}with\u{1f}separators");
    assert_eq!(page.commits[1].title, "");
}

#[tokio::test]
async fn git_read_should_use_literal_history_paths() {
    let repo = Repository::new();
    fs::write(repo.0.join("a[1].txt"), "selected literal\n").unwrap();
    fs::write(repo.0.join("a1.txt"), "wrong wildcard\n").unwrap();
    git(&repo.0, &["add", "."]);
    git(&repo.0, &["commit", "-m", "paths"]);
    let sha = git(&repo.0, &["rev-parse", "HEAD"]);
    let diff = get_commit_diff(&repo.0, None, &sha, "a[1].txt")
        .await
        .unwrap();
    assert!(diff.diff.contains("selected literal"));
    assert!(!diff.diff.contains("wrong wildcard"));
}

#[tokio::test]
async fn git_read_should_detect_changes_inside_collapsed_directories() {
    let repo = Repository::new();
    fs::create_dir(repo.0.join("new")).unwrap();
    fs::write(repo.0.join("new/file.txt"), "one").unwrap();
    let first = get_git_status(&repo.0, None, false).await.unwrap();
    fs::write(repo.0.join("new/file.txt"), "two").unwrap();
    let second = get_git_status(&repo.0, None, false).await.unwrap();
    assert_ne!(first.snapshot, second.snapshot);
    assert_eq!(second.unstaged[0].path, "new/");
}

#[tokio::test]
async fn git_read_should_return_conflict_details_without_path_errors() {
    let repo = Repository::new();
    git(&repo.0, &["checkout", "-b", "other"]);
    fs::write(repo.0.join("old.txt"), "other\n").unwrap();
    git(&repo.0, &["commit", "-am", "other"]);
    git(&repo.0, &["checkout", "main"]);
    fs::write(repo.0.join("old.txt"), "main\n").unwrap();
    git(&repo.0, &["commit", "-am", "main"]);
    let merge = Command::new("git")
        .args(["merge", "other"])
        .current_dir(&repo.0)
        .output()
        .unwrap();
    assert!(!merge.status.success());
    let status = get_git_status(&repo.0, None, true).await.unwrap();
    assert!(
        status
            .unstaged
            .iter()
            .any(|change| change.path == "old.txt" && change.diff.contains("<<<<<<< HEAD"))
    );
}

#[tokio::test]
async fn git_read_should_not_refresh_index_on_background_status() {
    let repo = Repository::new();
    // 原子替换为相同内容，确保 Git 有需要刷新但不必落盘的 stat 信息。
    fs::write(repo.0.join("replacement"), "baseline\n").unwrap();
    fs::rename(repo.0.join("replacement"), repo.0.join("old.txt")).unwrap();
    let before = fs::read(repo.0.join(".git/index")).unwrap();
    get_git_status(&repo.0, None, false).await.unwrap();
    assert_eq!(fs::read(repo.0.join(".git/index")).unwrap(), before);
}

#[cfg(unix)]
#[tokio::test]
async fn git_read_should_preview_symlink_text_without_following_target() {
    let repo = Repository::new();
    std::os::unix::fs::symlink("/missing/outside.txt", repo.0.join("link.txt")).unwrap();
    let status = get_git_status(&repo.0, None, true).await.unwrap();
    assert!(status.unstaged[0].diff.contains("+/missing/outside.txt"));
}

#[tokio::test]
async fn git_read_should_track_gitlink_head_changes_with_same_status() {
    let repo = Repository::new();
    let child = repo.0.join("child");
    fs::create_dir(&child).unwrap();
    git(&child, &["init", "-b", "main"]);
    git(&child, &["config", "user.name", "Test"]);
    git(&child, &["config", "user.email", "test@example.com"]);
    fs::write(child.join("file"), "one").unwrap();
    git(&child, &["add", "."]);
    git(&child, &["commit", "-m", "one"]);
    git(&repo.0, &["add", "child"]);
    git(&repo.0, &["commit", "-m", "gitlink"]);
    git(&child, &["commit", "--allow-empty", "-m", "two"]);
    let first = get_git_status(&repo.0, None, false).await.unwrap();
    git(&child, &["commit", "--allow-empty", "-m", "three"]);
    let second = get_git_status(&repo.0, None, false).await.unwrap();
    assert_ne!(first.snapshot, second.snapshot);
}

#[test]
fn git_read_should_repair_truncated_hunk_counts() {
    let patch =
        b"diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1,3 +1,3 @@\n-old\n+new\n context\n extra\n";
    let end = patch.len() - b" extra\n".len();
    let diff = super::git_diff::patch_text(patch, end);
    assert!(diff.contains("@@ -1,2 +1,2 @@\n"));
    assert!(diff.ends_with(" context\n"));
}

#[tokio::test]
async fn git_read_should_mark_large_patch_as_truncated() {
    let repo = Repository::new();
    fs::write(repo.0.join("old.txt"), "new\n".repeat(150_000)).unwrap();
    let status = get_git_status(&repo.0, None, true).await.unwrap();
    let change = serde_json::to_value(&status.unstaged[0]).unwrap();
    assert_eq!(change["truncated"], true);
    assert!(status.unstaged[0].diff.len() <= 512 * 1024);
}

#[cfg(unix)]
#[tokio::test]
async fn git_read_should_preserve_literal_backslashes_in_untracked_patch_paths() {
    let repo = Repository::new();
    fs::write(repo.0.join("literal\\name.txt"), "content\n").unwrap();
    let status = get_git_status(&repo.0, None, true).await.unwrap();
    assert_eq!(status.unstaged[0].path, "literal\\name.txt");
    assert!(
        status.unstaged[0]
            .diff
            .contains("+++ \"b/literal\\\\name.txt\"\n")
    );
}

#[tokio::test]
#[ignore = "release-only Git read performance baseline"]
async fn performance_baseline_git_read_collapsed_directory() {
    let repo = Repository::new();
    fs::create_dir(repo.0.join("generated")).unwrap();
    for index in 0..2000 {
        fs::write(
            repo.0.join(format!("generated/file-{index:04}.txt")),
            "small file\n",
        )
        .unwrap();
    }
    let started = std::time::Instant::now();
    let first = get_git_status(&repo.0, None, false).await.unwrap();
    let cold_ms = started.elapsed().as_secs_f64() * 1000.0;
    let mut times = Vec::new();
    for _ in 0..10 {
        let started = std::time::Instant::now();
        let next = get_git_status(&repo.0, None, false).await.unwrap();
        times.push(started.elapsed().as_secs_f64() * 1000.0);
        assert_eq!(next.snapshot, first.snapshot);
        assert_eq!(next.unstaged.len(), 1);
        assert!(next.unstaged[0].diff.is_empty());
    }
    times.sort_by(f64::total_cmp);
    println!(
        "PERFORMANCE_BASELINE {}",
        serde_json::json!({
            "benchmark": "git_read_collapsed_directory", "files": 2000, "coldMs": cold_ms,
            "warmP50Ms": times[5], "warmP95Ms": times[9], "ipcBytes": serde_json::to_vec(&first).unwrap().len(),
        })
    );
}

#[tokio::test]
async fn git_read_should_generate_context_for_untracked_gitlinks() {
    let repo = Repository::new();
    let child = repo.0.join("embedded");
    fs::create_dir(&child).unwrap();
    git(&child, &["init", "-b", "main"]);
    git(&child, &["config", "user.name", "Test"]);
    git(&child, &["config", "user.email", "test@example.com"]);
    git(&child, &["commit", "--allow-empty", "-m", "embedded"]);
    let head = git(&child, &["rev-parse", "HEAD"]);
    let status = get_git_status(&repo.0, None, false).await.unwrap();
    let context =
        super::prepare_commit_message(&repo.0, None, &["embedded/".to_owned()], &status.snapshot)
            .await
            .unwrap();
    assert!(context.changes.contains(&head));
}
