use super::{CatalogError, acp_scheduled_configs::sql, db_error, string};
use rusqlite::{Connection, params};
use serde_json::{Value, json};

/// 跨 JSON 与 SQLite 的删除意图只保存身份和修订，不复制原始配置或历史正文。
pub(super) fn execute(db: &Connection, op: &str, input: &Value) -> Result<Value, CatalogError> {
    let source = string(input, "source")?;
    if !matches!(source, "web" | "desktop") {
        return Err(CatalogError::InvalidMessage);
    }
    if op == "acp.schedule.retirements" {
        let mut statement = db.prepare_cached(sql("retirements")?).map_err(db_error)?;
        let rows = statement
            .query_map([source], |row| {
                Ok(json!({
                    "scheduleId":row.get::<_,String>(0)?,"revision":row.get::<_,i64>(1)?
                }))
            })
            .map_err(db_error)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(db_error)?;
        return Ok(json!(rows));
    }
    let id = string(input, "scheduleId")?;
    if id.is_empty() || id.encode_utf16().count() > 256 {
        return Err(CatalogError::InvalidMessage);
    }
    if op == "acp.schedule.retire" {
        db.prepare_cached(sql("retire")?)
            .map_err(db_error)?
            .execute(params![source, id])
            .map_err(db_error)?;
        return Ok(Value::Null);
    }
    let revision = input["expectedRevision"]
        .as_i64()
        .filter(|v| (1..=9_007_199_254_740_991).contains(v))
        .ok_or(CatalogError::InvalidMessage)?;
    let removed = input["removed"]
        .as_bool()
        .ok_or(CatalogError::InvalidMessage)?;
    let transaction = db.unchecked_transaction().map_err(db_error)?;
    // 只有原意图仍匹配时才能删除，较新的配置及其他来源不受影响。
    if removed {
        transaction
            .execute(
                sql("finalize")?,
                params![source, id, revision, source, id, revision],
            )
            .map_err(db_error)?;
    }
    transaction
        .execute(sql("forgetRetirement")?, params![source, id, revision])
        .map_err(db_error)?;
    transaction.commit().map_err(db_error)?;
    Ok(Value::Null)
}
