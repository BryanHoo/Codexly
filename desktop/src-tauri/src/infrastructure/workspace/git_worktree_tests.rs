use std::fs;

use super::super::git_tests::{create_repository, output, run};
use super::*;

#[tokio::test]
async fn missing_worktree_should_not_block_listing_or_authorizing_healthy_worktrees() {
    let root = create_repository("codeagent-stale-worktree");
    fs::write(root.join("tracked.txt"), "initial\n").unwrap();
    run(&root, &["add", "."]);
    run(&root, &["commit", "-m", "initial"]);
    let root = fs::canonicalize(root).unwrap();
    let healthy = root.join(".worktree").join("healthy");
    let missing = root.join(".worktree").join("deleted");
    run(
        &root,
        &[
            "worktree",
            "add",
            "-b",
            "healthy",
            &git_path_argument(&healthy),
        ],
    );
    run(
        &root,
        &["worktree", "add", "--detach", &git_path_argument(&missing)],
    );
    // 模拟临时目录被系统清理：Git 登记仍存在，但工作文件目录已经消失。
    fs::remove_dir_all(&missing).unwrap();
    let registered = output(&root, &["worktree", "list", "--porcelain"]);
    assert!(registered.contains("prunable"));

    let page = list_worktrees(&root, None).await.unwrap();
    assert_eq!(page.worktrees.len(), 2);
    assert!(
        page.worktrees
            .iter()
            .any(|item| Path::new(&item.path) == root && item.current)
    );
    assert_eq!(
        switch_worktree(&root, None, healthy.to_str().unwrap())
            .await
            .unwrap()
            .branch
            .as_deref(),
        Some("healthy")
    );
    assert!(
        switch_worktree(&root, None, missing.to_str().unwrap())
            .await
            .is_err()
    );
    // 读取不能隐式 prune 或更改用户的 Git 管理记录。
    assert_eq!(
        output(&root, &["worktree", "list", "--porcelain"]),
        registered
    );
    fs::remove_dir_all(root).unwrap();
}
