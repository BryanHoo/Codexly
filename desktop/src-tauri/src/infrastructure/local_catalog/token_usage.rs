use super::{CatalogError, LocalCatalog, db_error, string};
use rusqlite::{Connection, types::ValueRef};
use serde_json::{Value, json};
use std::sync::OnceLock;

fn sql() -> Result<&'static Value, CatalogError> {
    static SQL: OnceLock<Value> = OnceLock::new();
    if let Some(value) = SQL.get() {
        return Ok(value);
    }
    let value = serde_json::from_str(include_str!(
        "../../../../../packages/protocol/src/token-usage-sql.json"
    ))
    .map_err(|_| CatalogError::InvalidMessage)?;
    Ok(SQL.get_or_init(|| value))
}
pub(super) fn initialize(db: &Connection) -> Result<(), CatalogError> {
    db.execute_batch(string(sql()?, "schema")?)
        .map_err(db_error)
}
/// 与 Web Worker 执行同一份 SQL，计数去重、缓存拆分和跨端日期归属保持一致。
pub(super) fn execute(
    db: &mut Connection,
    operation: &str,
    payload: &Value,
) -> Result<Value, CatalogError> {
    let sql = sql()?;
    let encoded = payload.to_string();
    if operation == "usage.query" {
        payload["year"]
            .as_u64()
            .filter(|year| (2000..=9999).contains(year))
            .ok_or(CatalogError::InvalidMessage)?;
        if payload
            .get("engine")
            .is_some_and(|engine| engine != "codex" && engine != "claude")
        {
            return Err(CatalogError::InvalidMessage);
        }
        let days = rows(db, string(sql, "query")?, &encoded)?;
        let tasks = if payload["day"].is_string() {
            rows(db, string(sql, "details")?, &encoded)?
        } else {
            Vec::new()
        };
        return Ok(json!({"days":days,"tasks":tasks}));
    }
    let sample = if operation == "usage.codex" {
        db.prepare_cached(string(sql, "codex")?)
            .map_err(db_error)?
            .query_row([&encoded], |row| row.get::<_, String>(0))
            .map_err(db_error)?
    } else {
        encoded
    };
    let transaction = db.transaction().map_err(db_error)?;
    transaction
        .prepare_cached(string(sql, "seed")?)
        .map_err(db_error)?
        .execute([&sample])
        .map_err(db_error)?;
    transaction
        .prepare_cached(string(sql, "write")?)
        .map_err(db_error)?
        .execute([&sample])
        .map_err(db_error)?;
    transaction.commit().map_err(db_error)?;
    Ok(Value::Null)
}
fn rows(db: &Connection, sql: &str, encoded: &str) -> Result<Vec<Value>, CatalogError> {
    let mut statement = db.prepare_cached(sql).map_err(db_error)?;
    let columns = statement
        .column_names()
        .iter()
        .map(|name| (*name).to_owned())
        .collect::<Vec<_>>();
    statement
        .query_map([encoded], |row| {
            let mut object = serde_json::Map::new();
            for (index, name) in columns.iter().enumerate() {
                let value = match row.get_ref(index)? {
                    ValueRef::Integer(value) => json!(value),
                    ValueRef::Text(value) => json!(String::from_utf8_lossy(value)),
                    _ => Value::Null,
                };
                object.insert(name.clone(), value);
            }
            Ok(Value::Object(object))
        })
        .map_err(db_error)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(db_error)
}

impl LocalCatalog {
    /// 单个有界队列保持采集顺序；消息线程只入队，不等待 SQLite 或 fsync。
    pub fn enqueue_codex_usage(&self, sample: Value) {
        let sender = self.inner.usage.get_or_init(|| {
            let (sender, mut receiver) = tokio::sync::mpsc::channel::<Value>(256);
            let store = std::sync::Arc::downgrade(&self.inner);
            let path = self.path.clone();
            tokio::spawn(async move {
                while let Some(sample) = receiver.recv().await {
                    let Some(inner) = store.upgrade() else {
                        break;
                    };
                    let catalog = LocalCatalog {
                        inner,
                        path: path.clone(),
                    };
                    if let Err(error) = catalog.call("usage.codex", sample).await {
                        log::error!("Token 用量统计保存失败: {error}");
                    }
                }
            });
            sender
        });
        if let Err(error) = sender.try_send(sample) {
            // 队列异常不阻塞模型执行；后续累计快照仍可从持久水位恢复增量。
            log::error!("Token 用量统计队列暂不可用: {error}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn shares_cumulative_deduplication_and_missing_fields_with_web() {
        let mut db = Connection::open_in_memory().unwrap();
        db.execute_batch("CREATE TABLE managed_tasks (id TEXT,title TEXT); CREATE TABLE managed_task_previews(task_id TEXT,preview TEXT);").unwrap();
        initialize(&db).unwrap();
        let sample = json!({"source":"s", "taskId":"t", "timestamp":"2026-10-22T00:00:00Z", "tokenUsage":{"total":{"inputTokens":1000,"cachedInputTokens":600,"outputTokens":100},"last":{"inputTokens":200,"cachedInputTokens":100,"outputTokens":30}}});
        execute(&mut db, "usage.codex", &sample).unwrap();
        execute(&mut db, "usage.codex", &sample).unwrap();
        let result = execute(
            &mut db,
            "usage.query",
            &json!({"year":2026,"day":"2026-10-22"}),
        )
        .unwrap();
        assert_eq!(
            result["days"][0],
            json!({"day":"2026-10-22","engine":"codex","taskCount":1,"totalTokens":230,"inputTokens":100,"cacheReadTokens":100,"outputTokens":30,"cacheWriteTokens":null})
        );
        assert_eq!(result["tasks"][0]["taskId"], "t");
    }
    #[tokio::test]
    async fn ordered_background_queue_should_preserve_first_baseline_and_cross_day_increments() {
        let directory = tempfile::tempdir().unwrap();
        let store = LocalCatalog::at(directory.path()).unwrap();
        store.enqueue_codex_usage(json!({"source":"s","taskId":"t","timestamp":"2026-10-21T00:00:00Z","tokenUsage":{"total":{"totalTokens":100},"last":{"totalTokens":100}}}));
        for total in 101..=200 {
            store.enqueue_codex_usage(json!({"source":"s","taskId":"t","timestamp":"2026-10-22T00:00:00Z","tokenUsage":{"total":{"totalTokens":total},"last":{"totalTokens":1}}}));
        }
        let result = tokio::time::timeout(std::time::Duration::from_secs(3), async {
            loop {
                let result = store
                    .call("usage.query", json!({"year":2026}))
                    .await
                    .unwrap();
                if result["days"]
                    .as_array()
                    .is_some_and(|days| days.len() == 2 && days[1]["totalTokens"] == 100)
                {
                    break result;
                }
                tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        assert_eq!(result["days"][0]["totalTokens"], 100);
        assert_eq!(result["days"][1]["totalTokens"], 100);
    }
}
