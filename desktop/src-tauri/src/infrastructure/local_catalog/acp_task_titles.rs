use super::{CatalogError, db_error, string};
use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use serde_json::{Value, json};
use std::sync::OnceLock;
fn sql(key: &str) -> Result<&'static str, CatalogError> {
    static CONTRACT: OnceLock<Result<Value, serde_json::Error>> = OnceLock::new();
    let contract = CONTRACT
        .get_or_init(|| {
            serde_json::from_str(include_str!(
                "../../../../../packages/protocol/src/acp-task-title-sql.json"
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
fn validate<'a>(p: &'a Value, keys: &[&str]) -> Result<(&'a str, &'a str), CatalogError> {
    let object = p.as_object().ok_or(CatalogError::InvalidMessage)?;
    if object.len() != keys.len() || keys.iter().any(|key| !object.contains_key(*key)) {
        return Err(CatalogError::InvalidMessage);
    }
    let id = string(p, "id")?;
    let token = string(p, "token")?;
    if !identifier(id) || !identifier(token) {
        return Err(CatalogError::InvalidMessage);
    }
    Ok((id, token))
}
/// 同源私有表只记录新任务；名称变更和归档由 SQLite 原子使领取失效。
pub(super) fn execute(db: &mut Connection, op: &str, p: &Value) -> Result<Value, CatalogError> {
    let keys = if op == "acp.title.claim" {
        vec!["id", "token", "engine", "projectId"]
    } else {
        vec!["id", "token", "title"]
    };
    let (id, token) = validate(p, &keys)?;
    let transaction = db
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(db_error)?;
    let result = if op == "acp.title.claim" {
        let engine = string(p, "engine")?;
        let project = match &p["projectId"] {
            Value::Null => None,
            Value::String(value) if identifier(value) => Some(value.as_str()),
            _ => return Err(CatalogError::InvalidMessage),
        };
        if !matches!(engine, "codex" | "claude") {
            return Err(CatalogError::InvalidMessage);
        }
        json!(
            transaction
                .execute(sql("claim")?, params![token, id, engine, project])
                .map_err(db_error)?
                > 0
        )
    } else {
        let title = match &p["title"] {
            Value::Null => None,
            Value::String(value)
                if !value.trim().is_empty() && value.chars().take(37).count() <= 36 =>
            {
                Some(value.as_str())
            }
            _ => return Err(CatalogError::InvalidMessage),
        };
        let owned = transaction
            .query_row(sql("owned")?, params![id, token], |row| {
                row.get::<_, i64>(0)
            })
            .optional()
            .map_err(db_error)?;
        if owned.is_none() {
            Value::Null
        } else {
            transaction
                .execute(sql("finish")?, params![id, token])
                .map_err(db_error)?;
            if let Some(title) = title {
                if transaction
                    .execute(sql("write")?, params![title, id])
                    .map_err(db_error)?
                    > 0
                {
                    json!(title)
                } else {
                    Value::Null
                }
            } else {
                Value::Null
            }
        }
    };
    transaction.commit().map_err(db_error)?;
    Ok(result)
}
