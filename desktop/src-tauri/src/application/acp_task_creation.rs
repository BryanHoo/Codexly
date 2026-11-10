use super::error::AppError;
use crate::infrastructure::{
    local_catalog::LocalCatalog, temporary_workspace, temporary_workspace_settings,
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use tokio::sync::Mutex;

// 本机单进程串行目录分配；跨进程以独占 mkdir / SQLite 不可覆盖插入约束兜底。
static CREATION: Mutex<()> = Mutex::const_new(());
fn creation_id(project: &str, key: &str) -> String {
    let mut digest = Sha256::new();
    digest.update((project.len() as u64).to_be_bytes());
    digest.update(project.as_bytes());
    digest.update(key.as_bytes());
    format!(
        "acp-{}",
        crate::encoding::encode_lower_hex(digest.finalize())
    )
}
pub(super) async fn create(
    directory: &Path,
    catalog: &LocalCatalog,
    project: &str,
    engine: &str,
    key: &str,
) -> Result<Value, AppError> {
    if !matches!(engine, "codex" | "claude")
        || project.is_empty()
        || project.len() > 1024
        || key.trim().is_empty()
        || key.len() > 128
    {
        return Err(AppError::Acp("Invalid ACP task creation identity".into()));
    }
    let _guard = CREATION.lock().await;
    let id = creation_id(project, key);
    let existing = catalog.call("task.read", json!({"id":id})).await?;
    if !existing.is_null() {
        if existing["provider"] != engine
            || existing["projectId"].as_str().unwrap_or("temporary") != project
        {
            return Err(AppError::Acp("ACP task creation identity conflict".into()));
        }
        return Ok(existing);
    }
    let cwd = if project == "temporary" {
        workspace(directory, &id).await?
    } else {
        let project = catalog.call("project.read", json!({"id":project})).await?;
        let path = project["path"]
            .as_str()
            .ok_or_else(|| AppError::Acp("ACP project not found".into()))?;
        let path = tokio::fs::canonicalize(path)
            .await
            .map_err(|_| AppError::FilesystemRequestFailed)?;
        if !tokio::fs::metadata(&path)
            .await
            .map_err(|_| AppError::FilesystemRequestFailed)?
            .is_dir()
        {
            return Err(AppError::FilesystemRequestFailed);
        }
        path
    };
    let task = json!({"id":id,"provider":engine,"projectId":if project=="temporary" {Value::Null} else {json!(project)},
        "cwd":if project=="temporary" {cwd.to_string_lossy().into_owned()} else {crate::infrastructure::local_catalog::project_path(&cwd)},"sessionId":null,"title":"","status":"idle",
        "pinned":false,"archived":false,"updatedAt":chrono::Utc::now().timestamp()});
    // 已绑定的工作区必须保留：写入响应失败不能证明没有提交，重试按同一 ID 恢复。
    catalog.call("task.put", task).await.map_err(Into::into)
}
async fn workspace(directory: &Path, id: &str) -> Result<PathBuf, AppError> {
    if let Some(path) = temporary_workspace_settings::task_workspace(directory, id)
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)?
    {
        return temporary_workspace::canonical_workspace(directory, &path)
            .await
            .map_err(|_| AppError::FilesystemRequestFailed);
    }
    let pending = temporary_workspace::create(directory)
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    match temporary_workspace::bind_task(directory, &pending, id).await {
        Ok(path) => Ok(path),
        Err(_) => {
            // 只清理本次尚未绑定的目录；不能删除可能由另一个创建请求完成的目标目录。
            temporary_workspace::remove(directory, &pending)
                .await
                .map_err(|_| AppError::FilesystemRequestFailed)?;
            Err(AppError::Acp(
                "ACP workspace binding failed; retry the same creation key".into(),
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::infrastructure::local_catalog::LocalCatalog;
    use serde_json::json;
    #[tokio::test]
    async fn creation_should_reuse_identity_and_reject_engine_changes() {
        let root = tempfile::tempdir().unwrap();
        let catalog = LocalCatalog::at(root.path()).unwrap();
        catalog.call("project.put",json!({"id":"p","name":"项目","path":root.path().to_string_lossy(),"createdAt":"2026-11-10T00:00:00Z"})).await.unwrap();
        let a = super::create(root.path(), &catalog, "p", "codex", "same")
            .await
            .unwrap();
        let b = super::create(root.path(), &catalog, "p", "codex", "same")
            .await
            .unwrap();
        assert_eq!(a["id"], b["id"]);
        assert!(
            super::create(root.path(), &catalog, "p", "claude", "same")
                .await
                .is_err()
        );
    }
    #[tokio::test]
    async fn temporary_creation_should_bind_one_workspace_and_retry_without_duplication() {
        let root = tempfile::tempdir().unwrap();
        let catalog = LocalCatalog::at(root.path()).unwrap();
        let a = super::create(root.path(), &catalog, "temporary", "claude", "same")
            .await
            .unwrap();
        let b = super::create(root.path(), &catalog, "temporary", "claude", "same")
            .await
            .unwrap();
        assert_eq!(a, b);
        crate::infrastructure::temporary_workspace::canonical_workspace(
            root.path(),
            std::path::Path::new(a["cwd"].as_str().unwrap()),
        )
        .await
        .unwrap();
        assert!(a["projectId"].is_null());
        assert!(a["sessionId"].is_null());
        assert_eq!(
            std::path::Path::new(a["cwd"].as_str().unwrap())
                .file_name()
                .unwrap(),
            a["id"].as_str().unwrap()
        );
        assert_eq!(
            std::fs::read_dir(root.path().join("temporary-workspaces"))
                .unwrap()
                .count(),
            1
        );
    }
    #[tokio::test]
    async fn failed_catalog_write_should_preserve_workspace_for_the_same_retry() {
        let root = tempfile::tempdir().unwrap();
        let catalog = LocalCatalog::at(root.path()).unwrap();
        catalog
            .call("task.read", json!({"id":"initialise"}))
            .await
            .unwrap();
        let db = rusqlite::Connection::open(root.path().join("state.sqlite3")).unwrap();
        db.execute_batch("CREATE TRIGGER fail_acp_creation BEFORE INSERT ON managed_tasks BEGIN SELECT RAISE(FAIL,'fixture'); END;").unwrap();
        assert!(
            super::create(root.path(), &catalog, "temporary", "codex", "retry")
                .await
                .is_err()
        );
        let workspace = std::fs::read_dir(root.path().join("temporary-workspaces"))
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path();
        db.execute_batch("DROP TRIGGER fail_acp_creation").unwrap();
        let task = super::create(root.path(), &catalog, "temporary", "codex", "retry")
            .await
            .unwrap();
        assert_eq!(
            std::fs::canonicalize(task["cwd"].as_str().unwrap()).unwrap(),
            std::fs::canonicalize(workspace).unwrap()
        );
        assert_eq!(
            std::fs::read_dir(root.path().join("temporary-workspaces"))
                .unwrap()
                .count(),
            1
        );
    }
    #[tokio::test]
    async fn unbound_creation_failure_should_preserve_existing_directory() {
        let root = tempfile::tempdir().unwrap();
        let catalog = LocalCatalog::at(root.path()).unwrap();
        let id = super::creation_id("temporary", "collision");
        let existing = root.path().join("temporary-workspaces").join(&id);
        std::fs::create_dir_all(&existing).unwrap();
        std::fs::write(existing.join("keep"), "user data").unwrap();
        assert!(
            super::create(root.path(), &catalog, "temporary", "codex", "collision")
                .await
                .is_err()
        );
        assert_eq!(
            std::fs::read_to_string(existing.join("keep")).unwrap(),
            "user data"
        );
        assert_eq!(
            std::fs::read_dir(root.path().join("temporary-workspaces"))
                .unwrap()
                .count(),
            1
        );
        assert!(
            catalog
                .call("task.read", json!({"id":id}))
                .await
                .unwrap()
                .is_null()
        );
    }
}
