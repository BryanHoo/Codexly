use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::atomic::{AtomicU64, Ordering},
    time::SystemTime,
};

use super::{WorkspaceError, commit_changes, get_git_status};

pub(super) struct Repository(pub(super) PathBuf);

impl Repository {
    pub(super) fn new() -> Self {
        let unique = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        static NEXT_REPOSITORY: AtomicU64 = AtomicU64::new(0);
        let sequence = NEXT_REPOSITORY.fetch_add(1, Ordering::Relaxed);
        let root = std::env::temp_dir().join(format!(
            "codeagent-git-integrity-{}-{unique}-{sequence}",
            std::process::id()
        ));
        fs::create_dir(&root).unwrap();
        git(&root, &["init", "-b", "main"]);
        git(&root, &["config", "user.name", "CodeAgent Test"]);
        git(&root, &["config", "user.email", "test@example.com"]);
        fs::write(root.join("old.txt"), "baseline\n").unwrap();
        git(&root, &["add", "."]);
        git(&root, &["commit", "-m", "baseline"]);
        Self(fs::canonicalize(root).unwrap())
    }
}

impl Drop for Repository {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}

fn git(root: &Path, args: &[&str]) -> String {
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
    String::from_utf8(output.stdout).unwrap().trim().to_owned()
}

#[tokio::test]
async fn commit_context_should_expand_selected_untracked_directories() {
    let repo = Repository::new();
    fs::create_dir_all(repo.0.join("新增目录/nested")).unwrap();
    fs::write(repo.0.join("新增目录/nested/new.txt"), "selected content\n").unwrap();
    fs::write(repo.0.join("新增目录/.gitignore"), "ignored.txt\n").unwrap();
    fs::write(repo.0.join("新增目录/ignored.txt"), "ignored secret\n").unwrap();
    fs::write(repo.0.join("outside.txt"), "unselected content\n").unwrap();
    let status = get_git_status(&repo.0, None, false).await.unwrap();
    assert!(
        status
            .unstaged
            .iter()
            .any(|change| change.path == "新增目录/")
    );

    let context =
        super::prepare_commit_message(&repo.0, None, &["新增目录/".to_owned()], &status.snapshot)
            .await
            .unwrap();

    assert!(context.changes.contains("新增目录/nested/new.txt"));
    assert!(context.changes.contains("selected content"));
    assert!(!context.changes.contains("ignored secret"));
    assert!(!context.changes.contains("unselected content"));
}

#[tokio::test]
async fn commit_context_should_bound_untracked_directory_content() {
    let repo = Repository::new();
    fs::create_dir(repo.0.join("new[1]")).unwrap();
    fs::write(repo.0.join("new[1]/large.txt"), "x".repeat(600 * 1024)).unwrap();
    fs::write(repo.0.join("new[1]/later.txt"), "later content").unwrap();
    fs::create_dir(repo.0.join("new1")).unwrap();
    fs::write(repo.0.join("new1/other.txt"), "wildcard content").unwrap();
    let status = get_git_status(&repo.0, None, false).await.unwrap();
    let context =
        super::prepare_commit_message(&repo.0, None, &["new[1]/".to_owned()], &status.snapshot)
            .await
            .unwrap();

    assert_eq!(context.changes.len(), 512 * 1024);
    assert!(context.changes.contains("new[1]/large.txt"));
    assert!(!context.changes.contains("later content"));
    assert!(!context.changes.contains("wildcard content"));
}

#[tokio::test]
async fn selected_rename_should_remove_original_and_preserve_other_staged_files() {
    let repo = Repository::new();
    git(&repo.0, &["mv", "old.txt", "new name.txt"]);
    fs::write(repo.0.join("other.txt"), "unselected\n").unwrap();
    git(&repo.0, &["add", "other.txt"]);
    let status = get_git_status(&repo.0, None, false).await.unwrap();
    commit_changes(
        &repo.0,
        None,
        &["new name.txt".to_owned()],
        "fix(test): 提交重命名",
        "commit",
        &status.snapshot,
    )
    .await
    .unwrap();
    assert_eq!(
        git(&repo.0, &["ls-tree", "--name-only", "HEAD"]),
        "new name.txt"
    );
    assert_eq!(
        git(&repo.0, &["diff", "--cached", "--name-only"]),
        "other.txt"
    );
}

#[tokio::test]
async fn snapshot_should_reject_changed_content_with_unchanged_status() {
    for area in ["unstaged", "staged", "untracked"] {
        let repo = Repository::new();
        let path = if area == "untracked" {
            "new.txt"
        } else {
            "old.txt"
        };
        fs::write(repo.0.join(path), "version one\n").unwrap();
        if area == "staged" {
            git(&repo.0, &["add", path]);
        }
        let before = get_git_status(&repo.0, None, false).await.unwrap();
        let porcelain = git(&repo.0, &["status", "--porcelain"]);
        fs::write(repo.0.join(path), "version two\n").unwrap();
        if area == "staged" {
            git(&repo.0, &["add", path]);
        }
        assert_eq!(git(&repo.0, &["status", "--porcelain"]), porcelain);
        let result = commit_changes(
            &repo.0,
            None,
            &[path.to_owned()],
            "fix(test): 拒绝过期内容",
            "commit",
            &before.snapshot,
        )
        .await;
        assert!(
            matches!(result, Err(WorkspaceError::SnapshotMismatch)),
            "{area}: {result:?}"
        );
    }
}
