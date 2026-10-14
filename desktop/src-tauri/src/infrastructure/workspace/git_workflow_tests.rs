use super::git_tests::{create_repository, output, run};
use super::{get_git_status, prepare_commit_message};
use std::fs;

#[tokio::test]
async fn remote_workflow_should_reject_removed_conflict_operations() {
    let repo = super::git_integrity_tests::Repository::new();
    let before = output(&repo.0, &["rev-parse", "HEAD"]);
    for action in ["resolve", "continue", "abort"] {
        let refused = super::git_remote::operate_remote(&repo.0, action, None, None, None)
            .await
            .unwrap();
        assert_eq!(refused.push_status, "failed");
        assert!(
            refused
                .push_error
                .unwrap()
                .contains("Unsupported Git remote action")
        );
        assert_eq!(output(&repo.0, &["rev-parse", "HEAD"]), before);
    }
}

#[tokio::test]
async fn remote_workflow_should_refuse_divergence_without_creating_a_merge() {
    let repo = super::git_integrity_tests::Repository::new();
    let other = super::git_integrity_tests::Repository::new();
    let remote = create_repository("codeagent-fast-forward-remote");
    run(&remote, &["config", "core.bare", "true"]);
    run(
        &repo.0,
        &["remote", "add", "origin", remote.to_str().unwrap()],
    );
    run(&repo.0, &["push", "-u", "origin", "main"]);
    run(
        &other.0,
        &["remote", "add", "origin", remote.to_str().unwrap()],
    );
    run(&other.0, &["fetch", "origin"]);
    run(&other.0, &["reset", "--hard", "origin/main"]);
    fs::write(other.0.join("old.txt"), "remote change\n").unwrap();
    run(&other.0, &["commit", "-am", "test(git): 修改远端"]);
    run(&other.0, &["push", "origin", "main"]);
    fs::write(repo.0.join("old.txt"), "local change\n").unwrap();
    run(&repo.0, &["commit", "-am", "test(git): 修改本地"]);
    let before = output(&repo.0, &["rev-parse", "HEAD"]);
    let refused = super::git_remote::operate_remote(&repo.0, "integrate", None, None, None)
        .await
        .unwrap();
    assert_eq!(refused.push_status, "failed");
    assert_eq!(refused.remote_state.unwrap().operation, "none");
    assert_eq!(output(&repo.0, &["rev-parse", "HEAD"]), before);
    assert!(
        output(&repo.0, &["status", "--porcelain"])
            .trim()
            .is_empty()
    );
    fs::remove_dir_all(remote).unwrap();
}

#[tokio::test]
async fn git_history_should_use_push_target_ancestry_and_leave_missing_refs_unknown() {
    let repo = super::git_integrity_tests::Repository::new();
    let root = &repo.0;
    let unknown = super::get_git_history(root, None, None).await.unwrap();
    assert!(
        serde_json::to_value(&unknown.commits).unwrap()[0]
            .get("unpushed")
            .is_none()
    );
    run(
        root,
        &[
            "remote",
            "add",
            "origin",
            "https://example.invalid/read.git",
        ],
    );
    run(
        root,
        &[
            "remote",
            "add",
            "publish",
            "https://example.invalid/write.git",
        ],
    );
    run(root, &["switch", "-c", "side"]);
    run(root, &["commit", "--allow-empty", "-m", "side commit"]);
    let side = output(root, &["rev-parse", "HEAD"]);
    run(root, &["switch", "main"]);
    run(root, &["commit", "--allow-empty", "-m", "main commit"]);
    run(root, &["merge", "--no-ff", "side", "-m", "merge side"]);
    run(root, &["update-ref", "refs/remotes/origin/main", "HEAD"]);
    run(
        root,
        &["update-ref", "refs/remotes/publish/main", side.trim()],
    );
    run(root, &["config", "branch.main.remote", "origin"]);
    run(root, &["config", "branch.main.merge", "refs/heads/main"]);
    run(root, &["config", "branch.main.pushRemote", "publish"]);
    let history = super::get_git_history(root, None, None).await.unwrap();
    let mut titles = history
        .commits
        .iter()
        .filter(|commit| commit.unpushed == Some(true))
        .map(|commit| commit.title.as_str())
        .collect::<Vec<_>>();
    titles.sort_unstable();
    assert_eq!(titles, ["main commit", "merge side"]);
    run(root, &["config", "branch.main.pushRemote", ""]);
    let history = super::get_git_history(root, None, None).await.unwrap();
    assert!(
        history
            .commits
            .iter()
            .all(|commit| commit.unpushed == Some(false))
    );
}

#[tokio::test]
async fn git_history_should_mark_unpushed_commits_across_pages_and_clear_after_push() {
    let root = create_repository("codeagent-history-unpushed");
    let remote = create_repository("codeagent-history-remote");
    run(&remote, &["config", "core.bare", "true"]);
    run(&root, &["commit", "--allow-empty", "-m", "baseline"]);
    run(
        &root,
        &["remote", "add", "origin", remote.to_str().unwrap()],
    );
    run(&root, &["push", "-u", "origin", "main"]);
    for index in 0..22 {
        run(
            &root,
            &["commit", "--allow-empty", "-m", &format!("local {index}")],
        );
    }
    let page = super::get_git_history(&root, None, Some("20"))
        .await
        .unwrap();
    let commits = serde_json::to_value(&page.commits).unwrap();
    assert_eq!(commits[0]["unpushed"], true);
    assert_eq!(commits[1]["unpushed"], true);
    assert_eq!(commits[2]["unpushed"], false);
    run(&root, &["push", "origin", "main"]);
    let page = super::get_git_history(&root, None, None).await.unwrap();
    let commits = serde_json::to_value(&page.commits).unwrap();
    assert!(
        commits
            .as_array()
            .unwrap()
            .iter()
            .all(|commit| commit["unpushed"] == false)
    );
    fs::remove_dir_all(root).unwrap();
    fs::remove_dir_all(remote).unwrap();
}

#[tokio::test]
async fn remote_workflow_should_inspect_and_publish_an_explicit_remote() {
    let root = create_repository("codeagent-remote-workflow");
    let remote = create_repository("codeagent-remote-workflow-bare");
    run(&remote, &["config", "core.bare", "true"]);
    fs::write(root.join("tracked.txt"), "initial\n").unwrap();
    run(&root, &["add", "."]);
    run(&root, &["commit", "-m", "test(git): 初始化"]);
    run(
        &root,
        &["remote", "add", "origin", remote.to_str().unwrap()],
    );
    let inspected = super::git_remote::operate_remote(&root, "inspect", None, None, None)
        .await
        .unwrap();
    assert!(inspected.remote_state.as_ref().unwrap().upstream.is_none());
    let head = output(&root, &["rev-parse", "HEAD"]);
    let published = super::git_remote::operate_remote(&root, "publish", Some("origin"), None, None)
        .await
        .unwrap();
    assert_eq!(published.push_status, "pushed");
    assert_eq!(published.remote_state.as_ref().unwrap().ahead, Some(0));
    assert_eq!(output(&root, &["rev-parse", "HEAD"]), head);
    let before_edit = get_git_status(&root, None, false).await.unwrap();
    fs::write(root.join("tracked.txt"), "unrelated working edit\n").unwrap();
    let rechecked = super::operate_project_remote(
        &root,
        None,
        &before_edit.snapshot,
        super::RemoteAction {
            action: "inspect",
            remote: None,
            url: None,
            branch_name: None,
            expected_head: None,
            expected_branch: None,
        },
    )
    .await
    .unwrap();
    assert_eq!(
        rechecked.remote_state.as_ref().unwrap().head.as_deref(),
        Some(head.trim())
    );
    let pushed = super::operate_project_remote(
        &root,
        None,
        &before_edit.snapshot,
        super::RemoteAction {
            action: "push",
            remote: None,
            url: None,
            branch_name: None,
            expected_head: Some(head.trim()),
            expected_branch: Some("main"),
        },
    )
    .await
    .unwrap();
    assert_eq!(pushed.push_status, "pushed");
    let created =
        super::git_remote::operate_remote(&root, "branch", None, None, Some("feature/recovery"))
            .await
            .unwrap();
    assert_eq!(created.branch.as_deref(), Some("feature/recovery"));
    assert_eq!(created.push_status, "updated");
    fs::remove_dir_all(root).unwrap();
    fs::remove_dir_all(remote).unwrap();
}

#[tokio::test]
async fn commit_context_should_exclude_unstaged_edits_of_partially_staged_files() {
    let root = create_repository("codeagent-context-partial");
    fs::write(root.join("partial.txt"), "base\n").unwrap();
    run(&root, &["add", "."]);
    run(&root, &["commit", "-m", "test(git): 初始化文件"]);
    fs::write(root.join("partial.txt"), "INCLUDED_STAGED\n").unwrap();
    run(&root, &["add", "partial.txt"]);
    fs::write(root.join("partial.txt"), "EXCLUDED_WORKING\n").unwrap();
    let root = fs::canonicalize(root).unwrap();
    let status = get_git_status(&root, None, false).await.unwrap();
    let context = prepare_commit_message(&root, None, &["partial.txt".into()], &status.snapshot)
        .await
        .unwrap();
    assert!(context.changes.contains("INCLUDED_STAGED"));
    assert!(!context.changes.contains("EXCLUDED_WORKING"));
    fs::remove_dir_all(root).unwrap();
}
