use rusqlite::{Connection, OptionalExtension};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock, Weak},
};
mod acp_plan_completion;
#[cfg(test)]
mod acp_plan_completion_tests;
mod acp_plan_index;
#[cfg(test)]
mod acp_plan_index_tests;
#[cfg(test)]
mod acp_plan_resource_tests;
#[cfg_attr(
    not(test),
    expect(dead_code, reason = "资源交付尚未装配类型化二进制端口")
)]
mod acp_plan_resources;
#[cfg(test)]
mod acp_plan_scan_tests;
mod acp_plan_state;
#[cfg(test)]
mod acp_plan_state_tests;
mod acp_plan_validation;
mod acp_schedule_retirements;
#[cfg(test)]
mod acp_scheduled_config_tests;
mod acp_scheduled_configs;
#[cfg(test)]
mod acp_scheduled_plan_tests;
mod acp_scheduled_plans;
mod acp_submissions;
mod operations;
#[cfg(test)]
mod preview_tests;
mod previews;
#[cfg(test)]
mod rollback_tests;
mod saved_prompts;

#[cfg(test)]
mod acp_submission_tests {
    use super::*;
    #[tokio::test]
    async fn acp_submission_should_retry_only_after_explicit_release_and_keep_identity() {
        let root = tempfile::tempdir().unwrap();
        let store = LocalCatalog::at(root.path()).unwrap();
        let request =
            json!({"projectId":"temporary","taskId":"t","key":"retry","fingerprint":"first"});
        assert_eq!(
            store
                .call("acp.submission.read", request.clone())
                .await
                .unwrap()["status"],
            "available"
        );
        store
            .call("acp.submission.begin", request.clone())
            .await
            .unwrap();
        store
            .call("acp.submission.retry", request.clone())
            .await
            .unwrap();
        let mut changed_retry = request.clone();
        changed_retry["fingerprint"] = json!("different-input");
        assert_eq!(
            store
                .call("acp.submission.read", changed_retry)
                .await
                .unwrap()["status"],
            "conflict"
        );
        assert_eq!(
            store
                .call("acp.submission.begin", request.clone())
                .await
                .unwrap()["status"],
            "reserved"
        );
        let mut changed = request.clone();
        changed["taskId"] = json!("other");
        assert_eq!(
            store.call("acp.submission.retry", changed).await.unwrap()["status"],
            "conflict"
        );
        assert_eq!(
            store.call("acp.submission.read", request).await.unwrap()["status"],
            "unknown"
        );
    }

    #[tokio::test]
    async fn acp_submission_should_reserve_once_across_sqlite_connections() {
        let root = tempfile::tempdir().unwrap();
        LocalCatalog::at(root.path())
            .unwrap()
            .call("task.read", json!({"id":"initialise"}))
            .await
            .unwrap();
        let gate = Arc::new(std::sync::Barrier::new(2));
        let workers: Vec<_> = (0..2).map(|_| {
            let path = root.path().join("state.sqlite3");
            let gate = Arc::clone(&gate);
            std::thread::spawn(move || {
                let mut db = Connection::open(path).unwrap();
                db.busy_timeout(std::time::Duration::from_secs(5)).unwrap();
                gate.wait();
                super::acp_submissions::execute(&mut db,"acp.submission.begin",&json!({"projectId":"temporary","taskId":"t","key":"once","fingerprint":"same"})).unwrap()["status"].as_str().unwrap().to_owned()
            })
        }).collect();
        let mut outcomes: Vec<_> = workers
            .into_iter()
            .map(|worker| worker.join().unwrap())
            .collect();
        outcomes.sort();
        assert_eq!(outcomes, vec!["reserved", "unknown"]);
    }

    #[tokio::test]
    async fn acp_submission_should_preserve_unknown_and_completed_results_across_reopen() {
        let root = tempfile::tempdir().unwrap();
        let store = LocalCatalog::at(root.path()).unwrap();
        let request =
            json!({"projectId":"temporary","taskId":"t","key":"once","fingerprint":"first"});
        let first = store
            .call("acp.submission.begin", request.clone())
            .await
            .unwrap();
        assert_eq!(first["status"], "reserved");
        drop(store);
        let store = LocalCatalog::at(root.path()).unwrap();
        assert_eq!(
            store
                .call("acp.submission.begin", request.clone())
                .await
                .unwrap()["status"],
            "unknown"
        );
        let mut conflict = request.clone();
        conflict["fingerprint"] = json!("changed");
        assert_eq!(
            store.call("acp.submission.begin", conflict).await.unwrap()["status"],
            "conflict"
        );
        let mut completed = request.clone();
        completed["result"] = json!({"id":"turn-one"});
        store
            .call("acp.submission.complete", completed)
            .await
            .unwrap();
        drop(store);
        let store = LocalCatalog::at(root.path()).unwrap();
        let replay = store.call("acp.submission.begin", request).await.unwrap();
        assert_eq!(
            replay,
            json!({"status":"completed","result":{"id":"turn-one"}})
        );
    }
}

#[derive(Clone)]
pub struct LocalCatalog {
    inner: Arc<SharedConnection>,
    path: PathBuf,
}
struct SharedConnection {
    database: Mutex<Option<Connection>>,
}
static STORES: OnceLock<Mutex<HashMap<PathBuf, Weak<SharedConnection>>>> = OnceLock::new();

/// Windows 原生 canonicalize 返回扩展路径，移除前缀以与 Node realpath 的项目身份一致。
pub fn project_path(path: &Path) -> String {
    let path = path.to_string_lossy();
    if let Some(unc) = path.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{unc}")
    } else {
        path.strip_prefix(r"\\?\").unwrap_or(&path).to_owned()
    }
}

impl LocalCatalog {
    pub fn app_data(&self) -> Result<&Path, CatalogError> {
        self.path.parent().ok_or(CatalogError::StateUnavailable)
    }
    pub fn at(app_data: &Path) -> Result<Self, CatalogError> {
        let path = app_data.join("state.sqlite3");
        let mut stores = STORES
            .get_or_init(Default::default)
            .lock()
            .map_err(|_| CatalogError::StateUnavailable)?;
        if let Some(inner) = stores.get(&path).and_then(Weak::upgrade) {
            return Ok(Self { inner, path });
        }
        // The registry shares live stores without keeping SQLite files open after their users exit.
        stores.retain(|_, store| store.strong_count() > 0);
        let inner = Arc::new(SharedConnection {
            database: Mutex::new(None),
        });
        stores.insert(path.clone(), Arc::downgrade(&inner));
        Ok(Self { inner, path })
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
        self.with_database(|db| operations::execute(db, operation, payload))
    }
    // 类型化二进制端口共用连接初始化与互斥，避免把字节转成 JSON。
    fn with_database<R>(
        &self,
        action: impl FnOnce(&mut Connection) -> Result<R, CatalogError>,
    ) -> Result<R, CatalogError> {
        let mut guard = self
            .inner
            .database
            .lock()
            .map_err(|_| CatalogError::StateUnavailable)?;
        if guard.is_none() {
            if let Some(parent) = self.path.parent() {
                std::fs::create_dir_all(parent).map_err(|_| CatalogError::StateUnavailable)?;
            }
            let mut db = Connection::open(&self.path).map_err(db_error)?;
            super::sqlite_journal::enable_wal(&db).map_err(db_error)?;
            db.execute_batch("PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;")
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
            let schema: Value = serde_json::from_str(include_str!(
                "../../../../../packages/protocol/src/local-catalog-schema.json"
            ))
            .map_err(|_| CatalogError::InvalidMessage)?;
            saved_prompts::initialize(&db)?;
            acp_submissions::initialize(&mut db)?;
            acp_scheduled_configs::initialize(&db)?;
            acp_scheduled_plans::initialize(&db)?;
            acp_plan_completion::initialize(&db)?;
            acp_plan_resources::initialize(&db)?;
            // 两端共享幂等增量表；桌面先升级时也能与既有 Web 表列顺序兼容。
            db.execute_batch(string(&schema, "previewSql")?)
                .map_err(db_error)?;
            if let Some(source) = previews::default_source() {
                previews::recover(&mut db, &source)?;
            }
            *guard = Some(db);
        }
        action(guard.as_mut().ok_or(CatalogError::StateUnavailable)?)
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
    let mut value = json!({"id":row.get::<_,String>(0)?,"projectId":row.get::<_,Option<String>>(1)?,"title":row.get::<_,String>(2)?,"cwd":row.get::<_,String>(3)?,
        "provider":row.get::<_,String>(4)?,"sessionId":row.get::<_,Option<String>>(5)?,"updatedAt":row.get::<_,f64>(6)?,"pinned":row.get::<_,bool>(7)?,"archived":row.get::<_,bool>(8)?,"status":row.get::<_,String>(9)?});
    if let Some(preview) = row
        .get::<_, Option<String>>(10)?
        .filter(|value| !value.is_empty())
    {
        value["preview"] = json!(preview);
    }
    Ok(value)
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_web_history_and_observes_external_commits() {
        let dir = tempfile::tempdir().unwrap();
        let db = Connection::open(dir.path().join("state.sqlite3")).unwrap();
        let schema: Value = serde_json::from_str(include_str!(
            "../../../../../packages/protocol/src/local-catalog-schema.json"
        ))
        .unwrap();
        db.execute_batch(schema["sql"].as_str().unwrap()).unwrap();
        let store = LocalCatalog::at(dir.path()).unwrap();
        assert_eq!(
            store.execute("task.bindings", &Value::Null).unwrap(),
            json!([])
        );
        db.execute("INSERT INTO managed_tasks VALUES ('web-task',NULL,'Web 历史','/workspace','claude','session',1,0,0,'idle')", []).unwrap();
        assert_eq!(
            store
                .execute("task.read", &json!({"id":"web-task"}))
                .unwrap()["title"],
            "Web 历史"
        );
        store
            .execute("task.patch", &json!({"id":"web-task","title":"桌面修改"}))
            .unwrap();
        assert_eq!(
            db.query_row(
                "SELECT title FROM managed_tasks WHERE id='web-task'",
                [],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
            "桌面修改"
        );
    }

    #[test]
    fn engine_binding_should_reject_replacement_and_allow_cross_engine_session_ids() {
        let dir = tempfile::tempdir().unwrap();
        let store = LocalCatalog::at(dir.path()).unwrap();
        let task = json!({"id":"claude-task","projectId":null,"title":"会话","cwd":"/workspace","provider":"claude","sessionId":null,"updatedAt":100,"pinned":false,"archived":false,"status":"idle"});
        store.execute("task.put", &task).unwrap();
        store
            .execute(
                "task.patch",
                &json!({"id":"claude-task","sessionId":"native"}),
            )
            .unwrap();
        store
            .execute(
                "task.patch",
                &json!({"id":"claude-task","sessionId":"native"}),
            )
            .unwrap();
        for patch in [
            json!({"id":"claude-task","provider":"codex"}),
            json!({"id":"claude-task","projectId":"other"}),
            json!({"id":"claude-task","sessionId":"other"}),
            json!({"id":"claude-task","sessionId":null}),
        ] {
            assert!(store.execute("task.patch", &patch).is_err());
        }
        let mut collision = task.clone();
        collision["provider"] = json!("codex");
        assert!(store.execute("task.put", &collision).is_err());
        collision["id"] = json!("codex-task");
        collision["sessionId"] = json!("native");
        store.execute("task.put", &collision).unwrap();
        drop(store);
        let reopened = LocalCatalog::at(dir.path()).unwrap();
        let actual = reopened
            .execute("task.read", &json!({"id":"claude-task"}))
            .unwrap();
        assert_eq!(actual["provider"], "claude");
        assert_eq!(actual["sessionId"], "native");
    }

    #[test]
    fn catalog_should_release_database_after_last_user_and_reopen_persisted_data() {
        let dir = tempfile::tempdir().unwrap();
        let store = LocalCatalog::at(dir.path()).unwrap();
        let shared = LocalCatalog::at(dir.path()).unwrap();
        assert!(Arc::ptr_eq(&store.inner, &shared.inner));
        store
            .execute(
                "project.put",
                &json!({"id":"p","name":"project","path":"/workspace","createdAt":"2026-10-15T00:00:00Z"}),
            )
            .unwrap();
        let released = Arc::downgrade(&store.inner);
        drop(store);
        assert!(released.upgrade().is_some());
        drop(shared);
        assert!(released.upgrade().is_none());

        let reopened = LocalCatalog::at(dir.path()).unwrap();
        assert_eq!(
            reopened
                .execute("project.read", &json!({"id":"p"}))
                .unwrap()["name"],
            "project"
        );
        drop(reopened);
        dir.close().unwrap();
    }

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

    #[tokio::test]
    async fn search_filters_selected_engines_before_pagination() {
        let dir = tempfile::tempdir().unwrap();
        let store = LocalCatalog::at(dir.path()).unwrap();
        for (id, provider, time) in [
            ("new", "codex", 3),
            ("match", "claude", 2),
            ("older", "claude", 1),
        ] {
            store.call("task.put", json!({"id":id,"provider":provider,"updatedAt":time,"projectId":null,"title":"搜索","cwd":"/tmp","sessionId":null,"pinned":false,"archived":false,"status":"idle"})).await.unwrap();
        }
        let page = store
            .call("task.list", json!({"providers":["claude"],"limit":1}))
            .await
            .unwrap();
        assert_eq!(page["data"][0]["id"], "match");
        let next = store
            .call(
                "task.list",
                json!({"providers":["claude"],"limit":1,"cursor":page["nextCursor"]}),
            )
            .await
            .unwrap();
        assert_eq!(next["data"][0]["id"], "older");
    }
}

pub mod sidebar;

#[derive(Debug, thiserror::Error)]
pub enum CatalogError {
    #[error("duplicate")]
    DuplicatePrompt,
    #[error("task execution binding is immutable")]
    ImmutableBinding,
    #[error("stop the running task before removing it")]
    TaskRunning,
    #[error("invalid local catalog request or missing record")]
    InvalidMessage,
    #[error("local catalog storage is unavailable")]
    StateUnavailable,
}
