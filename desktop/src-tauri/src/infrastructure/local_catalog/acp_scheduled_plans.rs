use super::{CatalogError, db_error, string};
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::{Value, json};
use std::sync::OnceLock;

fn sql(name: &str) -> Result<&'static str, CatalogError> {
    static SQL: OnceLock<Result<Value, serde_json::Error>> = OnceLock::new();
    let value = SQL
        .get_or_init(|| {
            serde_json::from_str(include_str!(
                "../../../../../packages/protocol/src/acp-scheduled-plan-sql.json"
            ))
        })
        .as_ref()
        .map_err(|_| CatalogError::InvalidMessage)?;
    string(value, name)
}
pub(super) fn initialize(db: &Connection) -> Result<(), CatalogError> {
    db.execute_batch(sql("schema")?).map_err(db_error)?;
    super::acp_plan_state::initialize(db)
}
fn encode(v: &Value) -> Result<String, CatalogError> {
    if !super::acp_plan_validation::valid(v) {
        return Err(CatalogError::InvalidMessage);
    }
    let text = serde_json::to_string(v).map_err(|_| CatalogError::InvalidMessage)?;
    if text.len() > 524288 {
        return Err(CatalogError::InvalidMessage);
    }
    Ok(text)
}
fn row(r: &rusqlite::Row<'_>) -> rusqlite::Result<(String, String, String, i64)> {
    Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
}
fn record(r: Option<(String, String, String, i64)>) -> Result<Value, CatalogError> {
    let Some((source, id, text, revision)) = r else {
        return Ok(Value::Null);
    };
    let definition: Value =
        serde_json::from_str(&text).map_err(|_| CatalogError::InvalidMessage)?;
    encode(&definition)?;
    Ok(json!({"source":source,"scheduleId":id,"definition":definition,"revision":revision}))
}
/// 内部端口只保存独立定义；不向旧调度器注入未具备运行状态和附件资源的新计划。
pub(super) fn execute(db: &Connection, op: &str, p: &Value) -> Result<Value, CatalogError> {
    let source = string(p, "source")?;
    let id = string(p, "scheduleId")?;
    if !matches!(source, "web" | "desktop") || id.is_empty() || id.encode_utf16().count() > 256 {
        return Err(CatalogError::InvalidMessage);
    }
    if op == "acp.plan.read" {
        return record(
            db.prepare_cached(sql("read")?)
                .map_err(db_error)?
                .query_row(params![source, id], row)
                .optional()
                .map_err(db_error)?,
        );
    }
    let revision = p["expectedRevision"]
        .as_i64()
        .filter(|n| (0..=9_007_199_254_740_991).contains(n))
        .ok_or(CatalogError::InvalidMessage)?;
    if op == "acp.plan.delete" {
        return Ok(json!(
            db.execute(sql("delete")?, params![source, id, revision])
                .map_err(db_error)?
                > 0
        ));
    }
    let text = encode(&p["definition"])?;
    let result = if revision == 0 {
        db.prepare_cached(sql("insert")?)
            .map_err(db_error)?
            .query_row(params![source, id, text], row)
    } else {
        db.prepare_cached(sql("update")?)
            .map_err(db_error)?
            .query_row(params![text, source, id, revision, text], row)
    };
    record(result.optional().map_err(db_error)?)
}
