use super::{CatalogError, db_error, string};
use rusqlite::{Connection, OptionalExtension, TransactionBehavior, named_params, params};
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
    db.execute_batch(sql("schema")?).map_err(db_error)?;
    db.execute_batch(sql("sourcesSchema")?).map_err(db_error)
}
pub(super) fn mark_manual(db: &Connection, id: &str) -> Result<(), CatalogError> {
    db.execute(sql("markManual")?, [id]).map_err(db_error)?;
    Ok(())
}

pub(super) fn publish_agent(db: &mut Connection, p: &Value) -> Result<Value, CatalogError> {
    let id = string(p, "id")?;
    let engine = string(p, "engine")?;
    let session_id = string(p, "sessionId")?;
    let project_id = match p.get("projectId") {
        Some(Value::Null) => None,
        Some(Value::String(value)) if identifier(value) => Some(value.as_str()),
        _ => return Err(CatalogError::InvalidMessage),
    };
    let title = match p.get("title") {
        Some(Value::Null) => None,
        Some(Value::String(value))
            if !value.trim().is_empty() && value.encode_utf16().take(513).count() <= 512 =>
        {
            Some(value.as_str())
        }
        _ => return Err(CatalogError::InvalidMessage),
    };
    if p.as_object().is_none_or(|object| object.len() != 5)
        || !identifier(id)
        || !crate::infrastructure::acp_runtime::valid_agent_engine(engine)
        || session_id.is_empty()
        || session_id.len() > 1024
    {
        return Err(CatalogError::InvalidMessage);
    }
    // 受绑定约束的来源和目录标题共用事务，防止并发手动保存被覆盖。
    let transaction = db
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(db_error)?;
    let changed = transaction.execute(sql("saveAgent")?, named_params! {
        "@id": id, "@engine": engine, "@projectId": project_id, "@sessionId": session_id, "@title": title,
    }).map_err(db_error)?;
    let effective = if changed == 0 {
        None
    } else {
        transaction
            .query_row(sql("publishAgent")?, [id], |row| row.get::<_, String>(0))
            .optional()
            .map_err(db_error)?
    };
    transaction.commit().map_err(db_error)?;
    Ok(json!(effective))
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
        if !crate::infrastructure::acp_runtime::valid_agent_engine(engine) {
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
                    transaction
                        .execute(sql("saveGenerated")?, params![id, title])
                        .map_err(db_error)?;
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
