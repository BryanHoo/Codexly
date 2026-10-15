use rusqlite::{Connection, OptionalExtension};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock},
};
mod operations;

#[derive(Clone)]
pub struct LocalCatalog {
    inner: Arc<Mutex<Option<Connection>>>,
    path: PathBuf,
}
static STORES: OnceLock<Mutex<HashMap<PathBuf, LocalCatalog>>> = OnceLock::new();

impl LocalCatalog {
    pub fn app_data(&self) -> Result<&Path, CatalogError> {
        self.path.parent().ok_or(CatalogError::StateUnavailable)
    }
    pub fn at(app_data: &Path) -> Result<Self, CatalogError> {
        let path = app_data.join("catalog.sqlite3");
        let mut stores = STORES
            .get_or_init(Default::default)
            .lock()
            .map_err(|_| CatalogError::StateUnavailable)?;
        Ok(stores
            .entry(path.clone())
            .or_insert_with(|| Self {
                inner: Arc::new(Mutex::new(None)),
                path,
            })
            .clone())
    }
    pub async fn call(&self, operation: &str, payload: Value) -> Result<Value, CatalogError> {
        let this = self.clone();
        let operation = operation.to_owned();
        // SQLite 全部在阻塞池执行，绝不占用 Tokio 的流式响应与 IPC 线程。
        tokio::task::spawn_blocking(move || this.execute(&operation, &payload))
            .await
            .map_err(|_| CatalogError::StateUnavailable)?
    }
    fn execute(&self, operation: &str, payload: &Value) -> Result<Value, CatalogError> {
        let mut guard = self
            .inner
            .lock()
            .map_err(|_| CatalogError::StateUnavailable)?;
        if guard.is_none() {
            if let Some(parent) = self.path.parent() {
                std::fs::create_dir_all(parent).map_err(|_| CatalogError::StateUnavailable)?;
            }
            let mut db = Connection::open(&self.path).map_err(db_error)?;
            db.busy_timeout(std::time::Duration::from_secs(5))
                .map_err(db_error)?;
            db.execute_batch(
                "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;",
            )
            .map_err(db_error)?;
            let exists: Option<i64> = db
                .query_row(
                    "SELECT 1 FROM sqlite_master WHERE name='managed_projects'",
                    [],
                    |r| r.get(0),
                )
                .optional()
                .map_err(db_error)?;
            if exists.is_none() {
                let schema: Value = serde_json::from_str(include_str!(
                    "../../../../../packages/protocol/src/local-catalog-schema.json"
                ))
                .map_err(|_| CatalogError::InvalidMessage)?;
                let transaction = db.transaction().map_err(db_error)?;
                transaction
                    .execute_batch(string(&schema, "sql")?)
                    .map_err(db_error)?;
                transaction.commit().map_err(db_error)?;
            }
            *guard = Some(db);
        }
        operations::execute(
            guard.as_mut().ok_or(CatalogError::StateUnavailable)?,
            operation,
            payload,
        )
    }
}
fn db_error(error: rusqlite::Error) -> CatalogError {
    log::error!("本地目录数据库操作失败: {error}");
    CatalogError::StateUnavailable
}
fn string<'a>(value: &'a Value, key: &str) -> Result<&'a str, CatalogError> {
    value[key].as_str().ok_or(CatalogError::InvalidMessage)
}
fn project(row: &rusqlite::Row<'_>) -> rusqlite::Result<Value> {
    Ok(
        json!({"id":row.get::<_,String>(0)?,"name":row.get::<_,String>(1)?,"path":row.get::<_,String>(2)?,"createdAt":row.get::<_,String>(3)?}),
    )
}
fn task(row: &rusqlite::Row<'_>) -> rusqlite::Result<Value> {
    Ok(
        json!({"id":row.get::<_,String>(0)?,"projectId":row.get::<_,Option<String>>(1)?,"title":row.get::<_,String>(2)?,"cwd":row.get::<_,String>(3)?,
        "provider":row.get::<_,String>(4)?,"sessionId":row.get::<_,Option<String>>(5)?,"updatedAt":row.get::<_,f64>(6)?,"pinned":row.get::<_,bool>(7)?,"archived":row.get::<_,bool>(8)?,"status":row.get::<_,String>(9)?}),
    )
}
#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn persists_local_lifecycle_without_runtime() {
        let dir = tempfile::tempdir().unwrap();
        let store = LocalCatalog::at(dir.path()).unwrap();
        store.call("project.put",json!({"id":"p","name":"项目","path":"/workspace","createdAt":"2026-10-15T00:00:00Z"})).await.unwrap();
        store.call("task.put",json!({"id":"local","projectId":"p","title":"任务","cwd":"/workspace","provider":"codex","sessionId":"native","updatedAt":100,"pinned":false,"archived":false,"status":"idle"})).await.unwrap();
        store
            .call(
                "task.patch",
                json!({"id":"local","title":"本地名称","archived":true}),
            )
            .await
            .unwrap();
        assert_eq!(
            store
                .call("task.list", json!({"projectId":"p"}))
                .await
                .unwrap()["data"],
            json!([])
        );
        let page = store
            .call("task.list", json!({"projectId":"p","archived":true}))
            .await
            .unwrap();
        assert_eq!(page["data"][0]["title"], "本地名称");
        assert_eq!(page["data"][0]["sessionId"], "native");
    }
}

pub mod sidebar;

#[derive(Debug, thiserror::Error)]
pub enum CatalogError {
    #[error("stop the running task before removing it")]
    TaskRunning,
    #[error("invalid local catalog request or missing record")]
    InvalidMessage,
    #[error("local catalog storage is unavailable")]
    StateUnavailable,
}
