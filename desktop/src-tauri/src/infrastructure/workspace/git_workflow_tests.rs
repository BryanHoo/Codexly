use super::git_tests::{create_repository, output, run};
use super::{get_git_status, prepare_commit_message};
use std::fs;

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
    let inspected = super::git_remote::operate_remote(&root, "inspect", None, None, None, None)
        .await
        .unwrap();
    assert!(inspected.remote_state.as_ref().unwrap().upstream.is_none());
    let head = output(&root, &["rev-parse", "HEAD"]);
    let published =
        super::git_remote::operate_remote(&root, "publish", Some("origin"), None, None, None)
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
            paths: None,
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
            paths: None,
            branch_name: None,
            expected_head: Some(head.trim()),
            expected_branch: Some("main"),
        },
    )
    .await
    .unwrap();
    assert_eq!(pushed.push_status, "pushed");
    let created = super::git_remote::operate_remote(
        &root,
        "branch",
        None,
        None,
        None,
        Some("feature/recovery"),
    )
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
