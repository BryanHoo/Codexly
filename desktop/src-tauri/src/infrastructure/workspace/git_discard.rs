use super::{
    git_process::run_git,
    git_read::{GitStatus, repository_path},
    git_write::{validate_paths, validate_snapshot},
    path_guard::WorkspaceError,
};
use std::{collections::HashSet, path::Path};
const MAX_GIT_OUTPUT_BYTES: usize = 2 * 1024 * 1024;

/// 恢复所选文件的 index 和工作区；新增文件删除，未选中的路径保持原状。
pub async fn discard_changes(
    root: &Path,
    repository: Option<&str>,
    paths: &[String],
    expected_snapshot: &str,
) -> Result<GitStatus, WorkspaceError> {
    validate_paths(paths)?;
    if paths.len() > 500 {
        return Err(WorkspaceError::InvalidPath);
    }
    let status = validate_snapshot(root, repository, expected_snapshot).await?;
    let changed: HashSet<_> = status
        .staged
        .iter()
        .chain(&status.unstaged)
        .map(|change| change.path.as_str())
        .collect();
    if paths.iter().any(|path| !changed.contains(path.as_str())) {
        return Err(WorkspaceError::InvalidPath);
    }
    let requested: HashSet<_> = paths.iter().map(String::as_str).collect();
    if requested.len() != paths.len() {
        return Err(WorkspaceError::InvalidPath);
    }
    let repo = repository_path(root, repository).await?;
    let mut selected: HashSet<String> = paths.iter().cloned().collect();
    // 重命名是一个整体，恢复旧路径并移除新路径，不能留下半个重命名。
    for change in status.staged.iter().chain(&status.unstaged) {
        if requested.contains(change.path.as_str())
            && let Some(original) = &change.original_path
        {
            selected.insert(original.clone());
        }
    }
    let literal: Vec<_> = selected
        .iter()
        .map(|path| super::git_protocol::literal_path(path))
        .collect();
    let mut tracked = HashSet::new();
    for batch in super::git_protocol::path_batches(&literal) {
        let mut args = vec!["ls-files", "--stage", "-z", "--"];
        args.extend(batch.iter().map(String::as_str));
        let output = super::git_protocol::read_complete(
            &repo,
            &args,
            "discard selection",
            MAX_GIT_OUTPUT_BYTES,
        )
        .await?;
        for record in super::git_protocol::nul_records(&output, "discard selection")? {
            if record.starts_with(b"160000 ") {
                return Err(WorkspaceError::InvalidPath);
            }
            let separator = record
                .iter()
                .position(|byte| *byte == b'\t')
                .ok_or(WorkspaceError::InvalidPath)?;
            tracked.insert(super::git_protocol::path_text(&record[separator + 1..])?.to_owned());
        }
    }
    for change in status.staged.iter().chain(&status.unstaged) {
        if requested.contains(change.path.as_str())
            && let Some(original) = &change.original_path
        {
            tracked.insert(original.clone());
        }
    }
    for change in &status.staged {
        if change.kind == "delete" && selected.contains(&change.path) {
            tracked.insert(change.path.clone());
        }
    }
    validate_snapshot(root, repository, expected_snapshot).await?;
    if !tracked.is_empty() {
        let input = super::git_index_selection::path_input(tracked.iter().map(String::as_str));
        let args = if super::git_read::head_commit(&repo).await?.is_some() {
            vec![
                "restore",
                "--source=HEAD",
                "--staged",
                "--worktree",
                "--pathspec-from-file=-",
                "--pathspec-file-nul",
            ]
        } else {
            vec!["rm", "-f", "--pathspec-from-file=-", "--pathspec-file-nul"]
        };
        super::git_process::run_git_with_input(&repo, &args, MAX_GIT_OUTPUT_BYTES, &input).await?;
    }
    // 不使用 -x 或双 -f：保留忽略文件及嵌套仓库；仅清理用户确认的字面量范围。
    let untracked: Vec<_> = selected
        .iter()
        .filter(|path| !tracked.contains(*path))
        .map(|path| super::git_protocol::literal_path(path))
        .collect();
    for batch in super::git_protocol::path_batches(&untracked) {
        let mut args = vec!["clean", "-f", "-d", "--"];
        args.extend(batch.iter().map(String::as_str));
        run_git(&repo, &args, MAX_GIT_OUTPUT_BYTES).await?;
    }
    super::git_status_page::get_git_status_page(root, repository, None).await
}

#[cfg(test)]
mod tests {
    use super::super::{WorkspaceError, get_git_status};
    use std::{
        fs,
        path::{Path, PathBuf},
        process::Command,
        time::SystemTime,
    };
    fn output(root: &Path, args: &[&str]) -> String {
        let result = Command::new("git")
            .arg("-C")
            .arg(root)
            .args(args)
            .output()
            .unwrap();
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
        String::from_utf8(result.stdout).unwrap()
    }
    fn run(root: &Path, args: &[&str]) {
        output(root, args);
    }
    fn create_repository(prefix: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "{prefix}-{}",
            SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        run(&root, &["init", "-b", "main"]);
        run(&root, &["config", "user.name", "Test"]);
        run(&root, &["config", "user.email", "test@example.com"]);
        fs::canonicalize(root).unwrap()
    }
    #[tokio::test]
    async fn discard_should_restore_selected_rename_and_mixed_files_without_touching_other_index_entries()
     {
        let root = create_repository("codexly-discard");
        for name in ["a.txt", "b.txt", "old.txt"] {
            fs::write(root.join(name), "original").unwrap();
        }
        run(&root, &["add", "."]);
        run(&root, &["commit", "-m", "initial"]);
        fs::write(root.join("a.txt"), "staged").unwrap();
        fs::write(root.join("b.txt"), "keep").unwrap();
        run(&root, &["add", "."]);
        fs::write(root.join("a.txt"), "unstaged").unwrap();
        fs::write(root.join("new.txt"), "new").unwrap();
        run(&root, &["mv", "old.txt", "renamed.txt"]);
        let status = get_git_status(&root, None, false).await.unwrap();
        assert!(matches!(
            super::super::discard_changes(&root, None, &["a.txt".into()], &"0".repeat(64)).await,
            Err(WorkspaceError::SnapshotMismatch)
        ));
        assert!(
            super::super::discard_changes(&root, None, &["../escape".into()], &status.snapshot)
                .await
                .is_err()
        );
        super::super::discard_changes(
            &root,
            None,
            &["a.txt".into(), "new.txt".into(), "renamed.txt".into()],
            &status.snapshot,
        )
        .await
        .unwrap();
        assert_eq!(fs::read_to_string(root.join("a.txt")).unwrap(), "original");
        assert_eq!(
            fs::read_to_string(root.join("old.txt")).unwrap(),
            "original"
        );
        assert!(!root.join("new.txt").exists());
        assert!(!root.join("renamed.txt").exists());
        assert_eq!(output(&root, &["show", ":b.txt"]).trim(), "keep");
        fs::remove_dir_all(root).unwrap();
    }
    #[tokio::test]
    async fn discard_should_restore_staged_deletion_and_remove_staged_addition() {
        let root = create_repository("codexly-discard-deletion");
        fs::write(root.join("deleted.txt"), "original").unwrap();
        run(&root, &["add", "."]);
        run(&root, &["commit", "-m", "initial"]);
        run(&root, &["rm", "deleted.txt"]);
        fs::write(root.join("added.txt"), "new").unwrap();
        run(&root, &["add", "added.txt"]);
        let status = get_git_status(&root, None, false).await.unwrap();
        super::super::discard_changes(
            &root,
            None,
            &["deleted.txt".into(), "added.txt".into()],
            &status.snapshot,
        )
        .await
        .unwrap();
        assert_eq!(
            fs::read_to_string(root.join("deleted.txt")).unwrap(),
            "original"
        );
        assert!(!root.join("added.txt").exists());
        fs::remove_dir_all(root).unwrap();
    }
}
