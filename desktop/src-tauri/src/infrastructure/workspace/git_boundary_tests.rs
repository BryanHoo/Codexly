use std::{fs, path::Path, process::Command};

use super::git_integrity_tests::Repository;
use super::{commit_changes, get_git_status};

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
async fn chinese_parent_and_repository_paths_should_preserve_git_changes() {
    let fixture = Repository::new();
    let root = fixture.0.join("中文父目录 含空格").join("中文项目");
    fs::create_dir_all(&root).unwrap();
    git(&root, &["init", "-b", "主分支"]);
    git(&root, &["config", "user.name", "CodeAgent Test"]);
    git(&root, &["config", "user.email", "test@example.com"]);
    fs::write(root.join("已跟踪文件.txt"), "初始内容\n").unwrap();
    git(&root, &["add", "."]);
    git(&root, &["commit", "-m", "初次提交"]);
    fs::write(root.join("已跟踪文件.txt"), "修改内容\n").unwrap();
    fs::write(root.join("新增文件.txt"), "新内容\n").unwrap();
    let canonical = super::canonical_root(root.to_str().unwrap()).await.unwrap();
    get_git_status(&root, None, false).await.unwrap();
    let status = get_git_status(&canonical, None, true).await.unwrap();
    assert_eq!(status.branch.as_deref(), Some("主分支"));
    assert_eq!(status.repository_mode, "root");
    assert_eq!(status.unstaged.len(), 2);
    assert!(
        status
            .unstaged
            .iter()
            .any(|change| change.path == "新增文件.txt")
    );
    assert!(
        status
            .unstaged
            .iter()
            .any(|change| change.path == "已跟踪文件.txt")
    );
    #[cfg(windows)]
    {
        let ordinary = std::path::PathBuf::from(super::git_process::git_path_argument(&root));
        get_git_status(&ordinary, None, false).await.unwrap();
        let alternate = root.to_string_lossy().to_uppercase();
        let canonical = super::canonical_root(&alternate).await.unwrap();
        get_git_status(&canonical, None, false).await.unwrap();
    }
}

#[cfg(unix)]
#[tokio::test]
async fn commit_context_should_read_link_text_without_opening_its_target() {
    let repo = Repository::new();
    let outside = repo.0.with_extension("secret");
    fs::write(&outside, "PRIVATE_OUTSIDE_SENTINEL").unwrap();
    std::os::unix::fs::symlink(&outside, repo.0.join("link.txt")).unwrap();
    let status = get_git_status(&repo.0, None, false).await.unwrap();
    let context =
        super::prepare_commit_message(&repo.0, None, &["link.txt".into()], &status.snapshot)
            .await
            .unwrap();
    fs::remove_file(&outside).unwrap();
    assert!(!context.changes.contains("PRIVATE_OUTSIDE_SENTINEL"));
    assert!(context.changes.contains(outside.to_str().unwrap()));
}

#[tokio::test]
async fn commit_should_preserve_success_when_real_index_is_locked() {
    let repo = Repository::new();
    fs::write(repo.0.join("old.txt"), "changed\n").unwrap();
    let status = get_git_status(&repo.0, None, false).await.unwrap();
    fs::write(repo.0.join(".git/index.lock"), "external writer").unwrap();
    let result = commit_changes(
        &repo.0,
        None,
        &["old.txt".into()],
        "fix(test): 保留成功提交",
        "commit",
        &status.snapshot,
    )
    .await
    .expect("committed result must survive index synchronization failure");
    assert_eq!(result.commit_sha, git(&repo.0, &["rev-parse", "HEAD"]));
    assert_eq!(git(&repo.0, &["show", "HEAD:old.txt"]), "changed");
    let response = serde_json::to_value(result).unwrap();
    assert_eq!(response["indexSyncError"], "GIT_INDEX_SYNC_FAILED");
}

#[tokio::test]
async fn unborn_repository_should_report_changes_and_commit_selected_files() {
    let repo = Repository::new();
    git(&repo.0, &["checkout", "--orphan", "fresh"]);
    git(&repo.0, &["rm", "-rf", "."]);
    fs::write(repo.0.join("first.txt"), "first\n").unwrap();
    fs::write(repo.0.join("other.txt"), "unselected\n").unwrap();
    git(&repo.0, &["add", "other.txt"]);
    let status = get_git_status(&repo.0, None, true)
        .await
        .expect("unborn HEAD is valid");
    assert!(
        super::get_git_history(&repo.0, None, None)
            .await
            .unwrap()
            .commits
            .is_empty()
    );
    let result = commit_changes(
        &repo.0,
        None,
        &["first.txt".into()],
        "feat(test): 创建首次提交",
        "commit",
        &status.snapshot,
    )
    .await
    .unwrap();
    assert_eq!(result.commit_sha, git(&repo.0, &["rev-parse", "HEAD"]));
    assert_eq!(
        git(&repo.0, &["ls-tree", "--name-only", "HEAD"]),
        "first.txt"
    );
    assert_eq!(
        git(&repo.0, &["diff", "--cached", "--name-only"]),
        "other.txt"
    );
}
