use super::{CatalogError, db_error, string};
use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use serde_json::{Value, json};
use std::sync::OnceLock;

fn sql(key: &str) -> Result<&'static str, CatalogError> {
    static CONTRACT: OnceLock<Result<Value, serde_json::Error>> = OnceLock::new();
    let contract = CONTRACT
        .get_or_init(|| {
            serde_json::from_str(include_str!(
                "../../../../../packages/protocol/src/acp-storage-lock-sql.json"
            ))
        })
        .as_ref()
        .map_err(|_| CatalogError::InvalidMessage)?;
    string(contract, key)
}
pub(super) fn initialize(db: &Connection) -> Result<(), CatalogError> {
    db.execute_batch(sql("schema")?).map_err(db_error)
}
fn identifier(value: &str) -> bool {
    !value.is_empty() && value.encode_utf16().take(257).count() <= 256
}
fn field<'a>(p: &'a Value, key: &str) -> Result<&'a str, CatalogError> {
    let value = string(p, key)?;
    if !identifier(value) {
        return Err(CatalogError::InvalidMessage);
    }
    Ok(value)
}
/// 共享 SQL 实现有界原子领取；不依赖时间戳，也不在数据库层猜测进程存活。
pub(super) fn execute(db: &mut Connection, op: &str, p: &Value) -> Result<Value, CatalogError> {
    let keys: &[&str] = match op {
        "acp.storage.read" => &["key"],
        "acp.storage.claim" => &["key", "owner", "pid", "expectedOwner"],
        "acp.storage.release" => &["key", "owner"],
        _ => return Err(CatalogError::InvalidMessage),
    };
    let object = p.as_object().ok_or(CatalogError::InvalidMessage)?;
    if object.len() != keys.len() || keys.iter().any(|key| !object.contains_key(*key)) {
        return Err(CatalogError::InvalidMessage);
    }
    let key = field(p, "key")?;
    if op == "acp.storage.read" {
        return db
            .query_row(sql("read")?, [key], |row| {
                Ok(json!({
                    "owner":row.get::<_, String>(0)?, "pid":row.get::<_, i64>(1)?
                }))
            })
            .optional()
            .map(|value| value.unwrap_or(Value::Null))
            .map_err(db_error);
    }
    let owner = field(p, "owner")?;
    let transaction = db
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(db_error)?;
    let changed = if op == "acp.storage.release" {
        transaction
            .execute(sql("release")?, params![key, owner])
            .map_err(db_error)?
    } else {
        let pid = p["pid"]
            .as_f64()
            .filter(|value| value.fract() == 0.0 && *value >= 1.0 && *value <= 2_147_483_647.0)
            .ok_or(CatalogError::InvalidMessage)? as i64;
        let expected = match &p["expectedOwner"] {
            Value::Null => None,
            Value::String(value) if identifier(value) => Some(value.as_str()),
            _ => return Err(CatalogError::InvalidMessage),
        };
        transaction
            .execute(
                sql("claim")?,
                params![key, owner, pid, key, expected, expected],
            )
            .map_err(db_error)?
    };
    transaction.commit().map_err(db_error)?;
    Ok(json!(changed > 0))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn storage_locks_should_fence_reclaim_and_keep_old_schema() {
        let mut db = Connection::open_in_memory().unwrap();
        db.execute_batch(
            "PRAGMA user_version=27; CREATE TABLE managed_tasks(id TEXT PRIMARY KEY);",
        )
        .unwrap();
        initialize(&db).unwrap();
        let claim = json!({"key":"task","owner":"old","pid":123,"expectedOwner":null});
        assert_eq!(execute(&mut db, "acp.storage.claim", &claim).unwrap(), true);
        assert_eq!(
            execute(&mut db, "acp.storage.claim", &claim).unwrap(),
            false
        );
        let mut next = claim.clone();
        next["owner"] = json!("next");
        next["expectedOwner"] = json!("old");
        assert_eq!(execute(&mut db, "acp.storage.claim", &next).unwrap(), true);
        assert_eq!(
            execute(
                &mut db,
                "acp.storage.release",
                &json!({"key":"task","owner":"old"})
            )
            .unwrap(),
            false
        );
        assert_eq!(
            execute(&mut db, "acp.storage.read", &json!({"key":"task"})).unwrap(),
            json!({"owner":"next","pid":123})
        );
        assert!(
            execute(
                &mut db,
                "acp.storage.claim",
                &json!({"key":"bad","owner":"x","pid":-1,"expectedOwner":null})
            )
            .is_err()
        );
        assert_eq!(
            db.pragma_query_value::<i64, _>(None, "user_version", |row| row.get(0))
                .unwrap(),
            27
        );
        assert_eq!(
            execute(
                &mut db,
                "acp.storage.release",
                &json!({"key":"task","owner":"next"})
            )
            .unwrap(),
            true
        );
        // 已释放的资源不等于原 owner 仍存在，迟到接管不能重新插入一把锁。
        assert_eq!(execute(&mut db, "acp.storage.claim", &next).unwrap(), false);
    }
}
