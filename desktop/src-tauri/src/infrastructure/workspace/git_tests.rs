use std::{fs, path::Path, process::Command, time::SystemTime};

use super::git_process::git_path_argument;
use super::{
    WorkspaceError, commit_changes, create_branch, create_worktree, get_commit_diff,
    get_commit_files, get_git_history, get_git_status, list_worktrees, prepare_commit_message,
    switch_branch,
};

#[cfg(not(windows))]
const STATUS_SPECIAL_PATH: &str = "line\nbreak.txt";
#[cfg(windows)]
const STATUS_SPECIAL_PATH: &str = "unicode-功能.txt";
#[cfg(not(windows))]
const ARROW_SPECIAL_PATH: &str = "left -> right.txt";
#[cfg(windows)]
const ARROW_SPECIAL_PATH: &str = "left -＞ right.txt";
#[cfg(not(windows))]
const WORKTREE_SPECIAL_SUFFIX: &str = "-line\nbreak";
#[cfg(windows)]
const WORKTREE_SPECIAL_SUFFIX: &str = "-功能 路径";

#[tokio::test]
async fn git_reads_should_map_repository_state_and_history() {
    let unique = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let root = std::env::temp_dir().join(format!("codeagent-git-{unique}"));
    fs::create_dir_all(&root).unwrap();
    run(&root, &["init", "-b", "main"]);
    run(&root, &["config", "user.name", "CodeAgent Test"]);
    run(&root, &["config", "user.email", "test@example.com"]);
    fs::write(root.join("tracked.txt"), "first\n").unwrap();
    run(&root, &["add", "tracked.txt"]);
    run(&root, &["commit", "-m", "initial commit"]);
    let sha = output(&root, &["rev-parse", "HEAD"]);
    fs::write(root.join("tracked.txt"), "second\n").unwrap();
    fs::write(root.join("new.txt"), "new\n").unwrap();
    run(&root, &["add", "new.txt"]);
    let root = fs::canonicalize(root).unwrap();

    let status = get_git_status(&root, None, true).await.unwrap();
    assert_eq!(status.repository_mode, "root");
    assert_eq!(status.branch.as_deref(), Some("main"));
    assert_eq!(status.snapshot.len(), 64);
    assert_eq!(status.staged[0].path, "new.txt");
    assert_eq!(status.unstaged[0].path, "tracked.txt");

    let history = get_git_history(&root, None, None).await.unwrap();
    assert_eq!(history.commits[0].title, "initial commit");
    let files = get_commit_files(&root, None, &sha, None).await.unwrap();
    assert_eq!(files.files[0].path, "tracked.txt");
    let diff = get_commit_diff(&root, None, &sha, "tracked.txt")
        .await
        .unwrap();
    assert!(diff.diff.contains("first"));

    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn git_mutations_should_reject_stale_snapshots_and_commit_selected_paths() {
    let unique = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let root = std::env::temp_dir().join(format!("codeagent-git-write-{unique}"));
    fs::create_dir_all(&root).unwrap();
    run(&root, &["init", "-b", "main"]);
    run(&root, &["config", "user.name", "CodeAgent Test"]);
    run(&root, &["config", "user.email", "test@example.com"]);
    fs::write(root.join("tracked.txt"), "first\n").unwrap();
    run(&root, &["add", "tracked.txt"]);
    run(&root, &["commit", "-m", "initial commit"]);
    let root = fs::canonicalize(root).unwrap();

    let clean = get_git_status(&root, None, false).await.unwrap();
    create_branch(&root, None, "feature/test", &clean.snapshot)
        .await
        .unwrap();
    let feature = get_git_status(&root, None, false).await.unwrap();
    assert_eq!(feature.branch.as_deref(), Some("feature/test"));
    assert!(matches!(
        switch_branch(&root, None, "main", &clean.snapshot).await,
        Err(WorkspaceError::SnapshotMismatch)
    ));

    fs::write(root.join("tracked.txt"), "second\n").unwrap();
    let changed = get_git_status(&root, None, false).await.unwrap();
    let committed = commit_changes(
        &root,
        None,
        &["tracked.txt".to_owned()],
        "fix(workspace): 更新测试文件",
        "commit",
        &changed.snapshot,
    )
    .await
    .unwrap();
    assert_eq!(committed.push_status, "not_requested");
    assert_eq!(committed.message, "fix(workspace): 更新测试文件");

    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn commit_message_context_should_only_include_selected_changes() {
    let unique = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let root = std::env::temp_dir().join(format!("codeagent-git-message-{unique}"));
    fs::create_dir_all(&root).unwrap();
    run(&root, &["init", "-b", "main"]);
    run(&root, &["config", "user.name", "CodeAgent Test"]);
    run(&root, &["config", "user.email", "test@example.com"]);
    fs::write(root.join("selected.txt"), "before\n").unwrap();
    fs::write(root.join("ignored.txt"), "before\n").unwrap();
    run(&root, &["add", "."]);
    run(&root, &["commit", "-m", "initial commit"]);
    fs::write(root.join("selected.txt"), "selected change\n").unwrap();
    fs::write(root.join("ignored.txt"), "ignored change\n").unwrap();
    let root = fs::canonicalize(root).unwrap();
    let status = get_git_status(&root, None, false).await.unwrap();

    let context =
        prepare_commit_message(&root, None, &["selected.txt".to_owned()], &status.snapshot)
            .await
            .unwrap();

    assert!(context.changes.contains("selected change"));
    assert!(!context.changes.contains("ignored change"));
    assert_eq!(context.snapshot, status.snapshot);
    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn commit_changes_should_preserve_unselected_staged_files() {
    let root = create_repository("codeagent-git-selected");
    fs::write(root.join("selected.txt"), "selected old\n").unwrap();
    fs::write(root.join("unselected.txt"), "unselected old\n").unwrap();
    run(&root, &["add", "."]);
    run(&root, &["commit", "-m", "initial commit"]);
    fs::write(root.join("selected.txt"), "selected current\n").unwrap();
    fs::write(root.join("unselected.txt"), "unselected staged\n").unwrap();
    run(&root, &["add", "--", "unselected.txt"]);
    let root = fs::canonicalize(root).unwrap();
    let status = get_git_status(&root, None, false).await.unwrap();

    commit_changes(
        &root,
        None,
        &["selected.txt".to_owned()],
        "fix(workspace): 仅提交选择文件",
        "commit",
        &status.snapshot,
    )
    .await
    .unwrap();

    assert_eq!(
        output(&root, &["show", "--format=", "--name-only", "HEAD"]),
        "selected.txt"
    );
    assert_eq!(
        output(&root, &["diff", "--cached", "--name-only"]),
        "unselected.txt"
    );
    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn commit_changes_should_use_staged_content_for_mixed_files() {
    let root = create_repository("codeagent-git-mixed");
    fs::write(root.join("mixed.txt"), "old\n").unwrap();
    run(&root, &["add", "mixed.txt"]);
    run(&root, &["commit", "-m", "initial commit"]);
    fs::write(root.join("mixed.txt"), "staged\n").unwrap();
    run(&root, &["add", "mixed.txt"]);
    fs::write(root.join("mixed.txt"), "worktree\n").unwrap();
    let root = fs::canonicalize(root).unwrap();
    let status = get_git_status(&root, None, false).await.unwrap();

    commit_changes(
        &root,
        None,
        &["mixed.txt".to_owned()],
        "fix(workspace): 提交暂存版本",
        "commit",
        &status.snapshot,
    )
    .await
    .unwrap();

    assert_eq!(output(&root, &["show", "HEAD:mixed.txt"]), "staged");
    assert!(output(&root, &["diff", "--", "mixed.txt"]).contains("+worktree"));
    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn git_status_should_preserve_special_paths() {
    let root = create_repository("codeagent-git-paths");
    fs::write(root.join("tracked.txt"), "baseline\n").unwrap();
    run(&root, &["add", "tracked.txt"]);
    run(&root, &["commit", "-m", "initial commit"]);
    let paths = [
        "file with space.txt",
        STATUS_SPECIAL_PATH,
        ARROW_SPECIAL_PATH,
    ];
    for path in paths {
        fs::write(root.join(path), "content\n").unwrap();
    }
    let root = fs::canonicalize(root).unwrap();

    let status = get_git_status(&root, None, false).await.unwrap();
    let mut actual: Vec<_> = status
        .unstaged
        .into_iter()
        .map(|change| change.path)
        .collect();
    actual.sort_unstable();
    let mut expected = paths.map(str::to_owned);
    expected.sort_unstable();

    assert_eq!(actual, expected);
    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn git_status_should_split_combined_diffs_for_special_paths() {
    let root = create_repository("codeagent-git-diffs");
    let files = [
        ("file with space.txt", "space-marker"),
        (STATUS_SPECIAL_PATH, "special-marker"),
        (ARROW_SPECIAL_PATH, "arrow-marker"),
    ];
    for (path, marker) in files {
        fs::write(root.join(path), format!("old {marker}\n")).unwrap();
    }
    run(&root, &["add", "."]);
    run(&root, &["commit", "-m", "initial commit"]);
    for (path, marker) in files {
        fs::write(root.join(path), format!("new {marker}\n")).unwrap();
    }
    let root = fs::canonicalize(root).unwrap();

    let status = get_git_status(&root, None, true).await.unwrap();

    assert_eq!(status.unstaged.len(), files.len());
    for change in status.unstaged {
        let marker = files
            .iter()
            .find_map(|(path, marker)| (*path == change.path).then_some(marker))
            .unwrap();
        assert!(change.diff.contains(&format!("+new {marker}")));
        assert!(!change.diff.is_empty());
    }
    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn git_mutations_should_report_invalid_branch_and_missing_upstream() {
    let root = create_repository("codeagent-git-errors");
    fs::write(root.join("tracked.txt"), "old\n").unwrap();
    run(&root, &["add", "."]);
    run(&root, &["commit", "-m", "initial commit"]);
    let root = fs::canonicalize(root).unwrap();
    let clean = get_git_status(&root, None, false).await.unwrap();
    assert!(matches!(
        create_branch(&root, None, "invalid..branch", &clean.snapshot).await,
        Err(WorkspaceError::InvalidBranch)
    ));

    fs::write(root.join("tracked.txt"), "new\n").unwrap();
    let changed = get_git_status(&root, None, false).await.unwrap();
    let committed = commit_changes(
        &root,
        None,
        &["tracked.txt".to_owned()],
        "fix(workspace): 更新测试文件",
        "commit_and_push",
        &changed.snapshot,
    )
    .await
    .unwrap();

    assert_eq!(committed.push_status, "not_configured");
    assert_eq!(
        committed.push_error.as_deref(),
        Some("current branch has no upstream")
    );
    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn commit_and_push_should_publish_a_new_branch_and_set_its_upstream() {
    let root = create_repository("codeagent-git-new-branch-push");
    let remote = root.with_file_name(format!(
        "{}-remote.git",
        root.file_name().unwrap().to_string_lossy()
    ));
    fs::create_dir_all(&remote).unwrap();
    run(&remote, &["init", "--bare"]);
    fs::write(root.join("tracked.txt"), "initial\n").unwrap();
    run(&root, &["add", "."]);
    run(&root, &["commit", "-m", "initial commit"]);
    run(
        &root,
        &["remote", "add", "origin", remote.to_str().unwrap()],
    );
    run(&root, &["push", "--set-upstream", "origin", "main"]);
    let root = fs::canonicalize(root).unwrap();

    let clean = get_git_status(&root, None, false).await.unwrap();
    create_branch(&root, None, "feature/new-branch", &clean.snapshot)
        .await
        .unwrap();
    fs::write(root.join("tracked.txt"), "changed\n").unwrap();
    let changed = get_git_status(&root, None, false).await.unwrap();
    let committed = commit_changes(
        &root,
        None,
        &["tracked.txt".to_owned()],
        "fix(workspace): 更新测试文件",
        "commit_and_push",
        &changed.snapshot,
    )
    .await
    .unwrap();

    assert_eq!(committed.push_status, "pushed");
    assert_eq!(committed.push_error, None);
    assert_eq!(
        output(
            &root,
            &[
                "rev-parse",
                "--abbrev-ref",
                "--symbolic-full-name",
                "@{upstream}"
            ]
        ),
        "origin/feature/new-branch"
    );
    assert_eq!(
        output(&remote, &["rev-parse", "refs/heads/feature/new-branch"]),
        committed.commit_sha
    );
    fs::remove_dir_all(remote).unwrap();
    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn create_worktree_should_preserve_unicode_and_probe_a_numeric_suffix() {
    let root = create_repository("codeagent-git-worktree");
    fs::write(root.join("tracked.txt"), "initial\n").unwrap();
    run(&root, &["add", "."]);
    run(&root, &["commit", "-m", "initial commit"]);
    let root = fs::canonicalize(root).unwrap();
    let base_target = root.with_file_name(format!(
        "{}-功能-测试",
        root.file_name().unwrap().to_string_lossy()
    ));
    fs::create_dir(&base_target).unwrap();
    let status = get_git_status(&root, None, false).await.unwrap();

    let worktree = create_worktree(&root, None, "功能/测试", &status.snapshot)
        .await
        .unwrap();

    assert_eq!(
        Path::new(&worktree.path),
        base_target.with_file_name(format!(
            "{}-2",
            base_target.file_name().unwrap().to_string_lossy()
        ))
    );
    fs::remove_dir_all(&worktree.path).unwrap();
    fs::remove_dir_all(base_target).unwrap();
    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn list_worktrees_should_preserve_platform_special_paths() {
    let root = create_repository("codeagent-git-worktree-list");
    fs::write(root.join("tracked.txt"), "initial\n").unwrap();
    run(&root, &["add", "."]);
    run(&root, &["commit", "-m", "initial commit"]);
    let root = fs::canonicalize(root).unwrap();
    let target = root.with_file_name(format!(
        "{}{WORKTREE_SPECIAL_SUFFIX}",
        root.file_name().unwrap().to_string_lossy()
    ));
    let target_argument = git_path_argument(&target);
    run(
        &root,
        &[
            "worktree",
            "add",
            "-b",
            "newline-path",
            target_argument.as_str(),
        ],
    );
    let target = fs::canonicalize(target).unwrap();

    let worktrees = list_worktrees(&root, None).await.unwrap();

    assert!(worktrees.worktrees.iter().any(|worktree| {
        Path::new(&worktree.path) == target && worktree.branch.as_deref() == Some("newline-path")
    }));
    fs::remove_dir_all(target).unwrap();
    fs::remove_dir_all(root).unwrap();
}

pub(super) fn create_repository(prefix: &str) -> std::path::PathBuf {
    let unique = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let root = std::env::temp_dir().join(format!("{prefix}-{unique}"));
    fs::create_dir_all(&root).unwrap();
    run(&root, &["init", "-b", "main"]);
    run(&root, &["config", "user.name", "CodeAgent Test"]);
    run(&root, &["config", "user.email", "test@example.com"]);
    root
}

pub(super) fn run(root: &std::path::Path, args: &[&str]) {
    assert!(
        Command::new("git")
            .args(args)
            .current_dir(root)
            .status()
            .unwrap()
            .success()
    );
}

fn output(root: &std::path::Path, args: &[&str]) -> String {
    String::from_utf8(
        Command::new("git")
            .args(args)
            .current_dir(root)
            .output()
            .unwrap()
            .stdout,
    )
    .unwrap()
    .trim()
    .to_owned()
}
