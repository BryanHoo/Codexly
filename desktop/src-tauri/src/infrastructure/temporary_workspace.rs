use std::{
    io,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

use super::temporary_workspace_settings::{self, index_path, task_workspace, write_json};
use tokio::fs;

const WORKSPACE_DIRECTORY: &str = "temporary-workspaces";
const WORKSPACE_PREFIX: &str = "task-";
static WORKSPACE_SEQUENCE: AtomicU64 = AtomicU64::new(0);

pub async fn create(app_data: &Path) -> io::Result<PathBuf> {
    let root = temporary_workspace_settings::read_root(app_data).await?;
    fs::create_dir_all(&root).await?;
    let root = fs::canonicalize(root).await?;

    for _ in 0..32 {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let sequence = WORKSPACE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let workspace = root.join(format!(
            "{WORKSPACE_PREFIX}{timestamp}-{}-{sequence}",
            std::process::id()
        ));
        match fs::create_dir(&workspace).await {
            Ok(()) => {
                if let Err(error) = register(app_data, &workspace).await {
                    let _ = fs::remove_dir(&workspace).await;
                    return Err(error);
                }
                return Ok(workspace);
            }
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        }
    }

    Err(io::Error::new(
        io::ErrorKind::AlreadyExists,
        "failed to allocate a unique temporary workspace",
    ))
}

pub async fn canonical_workspace(app_data: &Path, workspace: &Path) -> io::Result<PathBuf> {
    let requested = workspace;
    let workspace = fs::canonicalize(workspace).await?;
    let name = workspace
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(invalid_workspace)?;
    // 索引保存在应用私有目录，根设置改变后仍按创建时的精确路径校验；拒绝符号链接替换。
    if let Some(registered) = task_workspace(app_data, name).await? {
        if registered == workspace
            && requested == workspace
            && fs::metadata(&workspace).await?.is_dir()
        {
            return Ok(workspace);
        }
        return Err(invalid_workspace());
    }
    let root = fs::canonicalize(app_data.join(WORKSPACE_DIRECTORY)).await?;
    let has_managed_name = workspace
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.starts_with(WORKSPACE_PREFIX));

    // 仅接受受控根目录的直接子目录，阻止路径穿越和符号链接逃逸。
    if workspace.parent() != Some(root.as_path())
        || !has_managed_name
        || !fs::metadata(&workspace).await?.is_dir()
    {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "temporary workspace is outside the managed directory",
        ));
    }
    Ok(workspace)
}

pub async fn remove(app_data: &Path, workspace: &Path) -> io::Result<()> {
    match canonical_workspace(app_data, workspace).await {
        Ok(workspace) => {
            fs::remove_dir_all(&workspace).await?;
            if let Some(name) = workspace.file_name().and_then(|name| name.to_str()) {
                let _ = fs::remove_file(index_path(app_data, name)?).await;
            }
            Ok(())
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            if let Some(name) = workspace.file_name().and_then(|name| name.to_str())
                && task_workspace(app_data, name).await?.as_deref() == Some(workspace)
            {
                let _ = fs::remove_file(index_path(app_data, name)?).await;
            }
            Ok(())
        }
        Err(error) => Err(error),
    }
}

pub async fn bind_task(app_data: &Path, workspace: &Path, task_id: &str) -> io::Result<PathBuf> {
    index_path(app_data, task_id)?;
    let workspace = canonical_workspace(app_data, workspace).await?;
    let target = workspace
        .parent()
        .ok_or_else(invalid_workspace)?
        .join(task_id);
    // 不接管已存在的同名目录，以免任务删除时误删用户内容。
    match fs::symlink_metadata(&target).await {
        Ok(_) => {
            return Err(io::Error::new(
                io::ErrorKind::AlreadyExists,
                "task workspace already exists",
            ));
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }
    fs::rename(&workspace, &target).await?;
    if let Err(error) = register(app_data, &target).await {
        let _ = fs::rename(&target, &workspace).await;
        return Err(error);
    }
    if let Some(name) = workspace.file_name().and_then(|name| name.to_str()) {
        let _ = fs::remove_file(index_path(app_data, name)?).await;
    }
    Ok(target)
}

async fn register(app_data: &Path, workspace: &Path) -> io::Result<()> {
    let name = workspace
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(invalid_workspace)?;
    write_json(
        &app_data.join("temporary-workspace-index"),
        &format!("{name}.json"),
        &workspace,
    )
    .await
}

fn invalid_workspace() -> io::Error {
    io::Error::new(
        io::ErrorKind::PermissionDenied,
        "temporary workspace is outside the managed directory",
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_root(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "codeagent-{name}-{}-{}",
            std::process::id(),
            WORKSPACE_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ))
    }

    #[tokio::test]
    async fn creates_and_removes_only_managed_workspaces() {
        let app_data = test_root("temporary-workspace");
        let workspace = create(&app_data).await.unwrap();
        fs::write(workspace.join("notes.md"), "content")
            .await
            .unwrap();

        assert_eq!(
            canonical_workspace(&app_data, &workspace).await.unwrap(),
            workspace
        );
        remove(&app_data, &workspace).await.unwrap();
        assert!(!workspace.exists());

        let _ = fs::remove_dir_all(app_data).await;
    }

    #[tokio::test]
    async fn rejects_directories_outside_the_managed_root() {
        let app_data = test_root("temporary-workspace-boundary");
        let workspace = create(&app_data).await.unwrap();
        let outside = app_data.join("task-outside");
        fs::create_dir_all(&outside).await.unwrap();

        assert_eq!(
            canonical_workspace(&app_data, &outside)
                .await
                .unwrap_err()
                .kind(),
            io::ErrorKind::PermissionDenied
        );
        assert!(outside.exists());

        let _ = remove(&app_data, &workspace).await;
        let _ = fs::remove_dir_all(app_data).await;
    }

    #[tokio::test]
    async fn selected_root_should_isolate_tasks_and_preserve_previous_locations() {
        let app_data = test_root("workspace-setting");
        let selected = app_data.join("selected");
        fs::create_dir_all(&selected).await.unwrap();
        super::super::temporary_workspace_settings::save_root(&app_data, &selected)
            .await
            .unwrap();
        let pending = create(&app_data).await.unwrap();
        let workspace = bind_task(&app_data, &pending, "task-id-123").await.unwrap();
        assert_eq!(
            workspace,
            fs::canonicalize(&selected)
                .await
                .unwrap()
                .join("task-id-123")
        );
        fs::write(workspace.join("result.txt"), "kept")
            .await
            .unwrap();
        let next = app_data.join("next");
        fs::create_dir_all(&next).await.unwrap();
        super::super::temporary_workspace_settings::save_root(&app_data, &next)
            .await
            .unwrap();
        assert_eq!(
            canonical_workspace(&app_data, &workspace).await.unwrap(),
            workspace
        );
        assert_eq!(
            fs::read_to_string(workspace.join("result.txt"))
                .await
                .unwrap(),
            "kept"
        );
        let another = create(&app_data).await.unwrap();
        assert_eq!(
            another.parent(),
            Some(fs::canonicalize(&next).await.unwrap().as_path())
        );
        remove(&app_data, &workspace).await.unwrap();
        assert!(selected.exists());
        fs::remove_dir_all(app_data).await.unwrap();
    }

    #[tokio::test]
    async fn binding_should_reject_path_traversal_and_existing_user_directories() {
        let app_data = test_root("workspace-collision");
        let pending = create(&app_data).await.unwrap();
        assert!(bind_task(&app_data, &pending, "../outside").await.is_err());
        let occupied = pending.parent().unwrap().join("existing");
        fs::create_dir(&occupied).await.unwrap();
        fs::write(occupied.join("keep.txt"), "user data")
            .await
            .unwrap();
        assert_eq!(
            bind_task(&app_data, &pending, "existing")
                .await
                .unwrap_err()
                .kind(),
            io::ErrorKind::AlreadyExists
        );
        assert_eq!(
            fs::read_to_string(occupied.join("keep.txt")).await.unwrap(),
            "user data"
        );
        fs::remove_dir_all(app_data).await.unwrap();
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn removal_should_reject_a_replaced_workspace_symlink() {
        let app_data = test_root("workspace-symlink");
        let pending = create(&app_data).await.unwrap();
        let workspace = bind_task(&app_data, &pending, "thread-link").await.unwrap();
        let outside = app_data.join("outside");
        fs::create_dir(&outside).await.unwrap();
        fs::write(outside.join("keep.txt"), "user data")
            .await
            .unwrap();
        fs::remove_dir(&workspace).await.unwrap();
        std::os::unix::fs::symlink(&outside, &workspace).unwrap();
        assert!(remove(&app_data, &workspace).await.is_err());
        assert!(outside.join("keep.txt").exists());
        fs::remove_dir_all(app_data).await.unwrap();
    }
}
