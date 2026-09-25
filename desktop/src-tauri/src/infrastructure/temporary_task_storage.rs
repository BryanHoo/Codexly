use super::{temporary_workspace, temporary_workspace_settings, workspace};
use std::{
    io,
    path::{Path, PathBuf},
};

pub async fn root(app_data: &Path, project_id: &str, task_id: &str) -> io::Result<Option<PathBuf>> {
    if project_id != "temporary" {
        return Ok(None);
    }
    let Some(path) = temporary_workspace_settings::task_workspace(app_data, task_id).await? else {
        return Ok(None);
    };
    temporary_workspace::canonical_workspace(app_data, &path)
        .await
        .map(Some)
}

pub async fn validate_attachment(
    app_data: &Path,
    project_id: &str,
    task_id: &str,
    id: &str,
) -> Result<PathBuf, workspace::WorkspaceError> {
    let task_root = root(app_data, project_id, task_id).await?;
    validate_attachment_in_root(app_data, project_id, task_id, task_root.as_deref(), id).await
}

pub async fn validate_attachment_in_root(
    app_data: &Path,
    project_id: &str,
    task_id: &str,
    task_root: Option<&Path>,
    id: &str,
) -> Result<PathBuf, workspace::WorkspaceError> {
    if let Some(root) = task_root
        && let Ok(path) = workspace::validate_attachment(root, "inputs", id).await
        && path.starts_with(root)
    {
        return Ok(path);
    }
    match workspace::validate_attachment(app_data, project_id, id).await {
        Ok(path) => Ok(path),
        Err(_) => {
            workspace::validate_attachment(app_data, &super::queued_media::scope(task_id), id).await
        }
    }
}

pub async fn retain_attachment(
    root: &Path,
    path: &Path,
    kind: &str,
) -> Result<PathBuf, workspace::WorkspaceError> {
    if path.starts_with(root)
        && workspace::validate_attachment(root, "inputs", &path.to_string_lossy())
            .await
            .is_ok()
    {
        return Ok(path.to_owned());
    }
    // 草稿仍可被排队编辑或重试引用，因此复制已验证的附件，不移动共享暂存文件。
    // import_attachment 流式复制并按内容去重，避免大附件驻留内存。
    let directory = root.join("attachments/inputs");
    tokio::fs::create_dir_all(&directory).await?;
    if tokio::fs::canonicalize(&directory).await? != directory {
        return Err(workspace::WorkspaceError::InvalidPath);
    }
    let stored =
        workspace::import_attachment(root, "inputs", kind, &path.to_string_lossy()).await?;
    Ok(PathBuf::from(stored.attachment.id))
}

pub async fn copy_workspace(source: &Path, target: &Path) -> io::Result<()> {
    if target.starts_with(source) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "fork destination must be outside the source workspace",
        ));
    }
    let mut directories = vec![(source.to_owned(), target.to_owned())];
    while let Some((source, target)) = directories.pop() {
        let mut entries = tokio::fs::read_dir(&source).await?;
        while let Some(entry) = entries.next_entry().await? {
            let kind = entry.file_type().await?;
            let destination = target.join(entry.file_name());
            if kind.is_dir() {
                tokio::fs::create_dir(&destination).await?;
                directories.push((entry.path(), destination));
            } else if kind.is_file() {
                tokio::fs::copy(entry.path(), destination).await?;
            }
            // 不跟随符号链接，避免把工作区外的内容复制进临时任务。
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn fork_workspace_should_keep_files_independent() {
        let app_data = std::env::temp_dir().join(format!(
            "codeagent-fork-storage-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let source = temporary_workspace::create(&app_data).await.unwrap();
        tokio::fs::write(source.join("result.txt"), "original")
            .await
            .unwrap();
        let target = temporary_workspace::create(&app_data).await.unwrap();
        copy_workspace(&source, &target).await.unwrap();
        tokio::fs::write(target.join("result.txt"), "changed")
            .await
            .unwrap();
        temporary_workspace::remove(&app_data, &target)
            .await
            .unwrap();
        assert_eq!(
            tokio::fs::read_to_string(source.join("result.txt"))
                .await
                .unwrap(),
            "original"
        );
        tokio::fs::remove_dir_all(app_data).await.unwrap();
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn task_attachment_should_reject_a_symlink_outside_its_workspace() {
        let app_data = std::env::temp_dir().join(format!(
            "codeagent-input-link-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let root = temporary_workspace::create(&app_data).await.unwrap();
        let outside = app_data.join("outside");
        tokio::fs::create_dir_all(&outside).await.unwrap();
        tokio::fs::create_dir(root.join("attachments"))
            .await
            .unwrap();
        tokio::fs::write(outside.join("secret.txt"), "private")
            .await
            .unwrap();
        std::os::unix::fs::symlink(&outside, root.join("attachments/inputs")).unwrap();
        assert!(
            validate_attachment_in_root(
                &app_data,
                "temporary",
                "task-a",
                Some(&root),
                &outside.join("secret.txt").to_string_lossy()
            )
            .await
            .is_err()
        );
        assert!(
            retain_attachment(&root, &outside.join("secret.txt"), "text")
                .await
                .is_err()
        );
        tokio::fs::remove_dir_all(app_data).await.unwrap();
    }
}
