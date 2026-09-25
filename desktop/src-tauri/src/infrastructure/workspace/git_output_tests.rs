#[cfg(unix)]
use super::WorkspaceError;
use super::git_tests::{create_repository, run};
use std::fs;

#[tokio::test]
async fn git_status_should_collapse_untracked_directories() {
    let root = create_repository("codeagent-git-many-untracked");
    let generated = root.join("generated");
    fs::create_dir(&generated).unwrap();
    for index in 0..3 {
        fs::write(
            generated.join(format!("artifact-{index}.txt")),
            "generated\n",
        )
        .unwrap();
    }
    let root = fs::canonicalize(root).unwrap();

    let status = super::get_git_status(&root, None, false).await.unwrap();

    assert_eq!(status.unstaged.len(), 1);
    assert_eq!(status.unstaged[0].path, "generated/");
    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn git_process_should_stop_stdout_over_two_mib_without_deadlock() {
    let root = create_repository("codeagent-git-large-stdout");
    fs::write(root.join("large.txt"), "before\n".repeat(400_000)).unwrap();
    run(&root, &["add", "large.txt"]);
    run(&root, &["commit", "-m", "add large file"]);
    fs::write(root.join("large.txt"), "after\n".repeat(400_000)).unwrap();
    let root = fs::canonicalize(root).unwrap();

    let (output, truncated) = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        super::git_process::run_git(
            &root,
            &["diff", "--no-ext-diff", "--", "large.txt"],
            2 * 1024 * 1024,
        ),
    )
    .await
    .expect("large Git stdout should not deadlock")
    .unwrap();

    assert!(truncated);
    assert_eq!(output.len(), 2 * 1024 * 1024);
    fs::remove_dir_all(root).unwrap();
}

#[cfg(unix)]
#[tokio::test]
async fn git_process_should_stop_stderr_over_two_mib_without_deadlock() {
    use std::os::unix::fs::PermissionsExt;

    let root = create_repository("codeagent-git-large-stderr");
    let hook = root.join(".git/hooks/pre-commit");
    fs::write(
        &hook,
        "#!/bin/sh\ni=0\nwhile [ \"$i\" -lt 400000 ]; do\n  printf 'hook-error\\n' >&2\n  i=$((i + 1))\ndone\nexit 1\n",
    )
    .unwrap();
    let mut permissions = fs::metadata(&hook).unwrap().permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(&hook, permissions).unwrap();
    let root = fs::canonicalize(root).unwrap();

    let error = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        super::git_process::run_git(
            &root,
            &["commit", "--allow-empty", "-m", "noisy hook"],
            2 * 1024 * 1024,
        ),
    )
    .await
    .expect("large Git stderr should not deadlock")
    .unwrap_err();

    assert!(matches!(error, WorkspaceError::GitCommandFailed(_)));
    fs::remove_dir_all(root).unwrap();
}
