use super::{CatalogError, db_error, string};
use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use serde_json::{Value, json};
use std::sync::OnceLock;

fn sql(name: &str) -> Result<&'static str, CatalogError> {
    static SQL: OnceLock<Result<Value, serde_json::Error>> = OnceLock::new();
    string(
        SQL.get_or_init(|| {
            serde_json::from_str(include_str!(
                "../../../../../packages/protocol/src/acp-plan-completion-sql.json"
            ))
        })
        .as_ref()
        .map_err(|_| CatalogError::InvalidMessage)?,
        name,
    )
}
pub(super) fn initialize(db: &Connection) -> Result<(), CatalogError> {
    db.execute_batch(sql("schema")?).map_err(db_error)
}
fn text<'a>(p: &'a Value, k: &str, max: usize) -> Result<&'a str, CatalogError> {
    let s = string(p, k)?;
    if s.is_empty() || s.encode_utf16().count() > max {
        return Err(CatalogError::InvalidMessage);
    }
    Ok(s)
}
fn optional<'a>(p: &'a Value, k: &str, max: usize) -> Result<Option<&'a str>, CatalogError> {
    if p.get(k) == Some(&Value::Null) {
        return Ok(None);
    }
    let s = string(p, k)?;
    if s.encode_utf16().count() > max {
        return Err(CatalogError::InvalidMessage);
    }
    Ok(Some(s))
}
fn outcome(p: &Value) -> Result<Value, CatalogError> {
    let status = string(p, "status")?;
    let project = text(p, "projectId", 128)?;
    let task = optional(p, "taskId", 256)?;
    let error = optional(p, "error", 2048)?;
    if task == Some("")
        || !((status == "started" && task.is_some() && error.is_none())
            || (status == "failed" && error.is_some()))
    {
        return Err(CatalogError::InvalidMessage);
    }
    Ok(
        json!({"source":p["source"],"scheduleId":p["scheduleId"],"runId":p["runId"],"projectId":project,"status":status,"taskId":task,"error":error}),
    )
}
fn read(db: &Connection, source: &str, id: &str, run: &str) -> Result<Value, CatalogError> {
    let s: Option<String> = db
        .prepare_cached(sql("read")?)
        .map_err(db_error)?
        .query_row(params![source, id, run], |r| r.get(0))
        .optional()
        .map_err(db_error)?;
    s.map(|s| {
        outcome(&serde_json::from_str::<Value>(&s).map_err(|_| CatalogError::InvalidMessage)?)
    })
    .unwrap_or(Ok(Value::Null))
}
/// 完成意图先于文件清理落盘，清理重试不再访问模型或重新准备输入。
pub(super) fn execute(db: &mut Connection, op: &str, p: &Value) -> Result<Value, CatalogError> {
    let source = string(p, "source")?;
    let id = text(p, "scheduleId", 256)?;
    let run = text(p, "runId", 256)?;
    if !matches!(source, "web" | "desktop") {
        return Err(CatalogError::InvalidMessage);
    }
    if op == "acp.plan.completion.read" {
        return read(db, source, id, run);
    }
    if op != "acp.plan.completion.put" {
        return Err(CatalogError::InvalidMessage);
    }
    let value = outcome(p)?;
    let tx = db
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(db_error)?;
    tx.execute(
        sql("put")?,
        params![
            value["projectId"].as_str(),
            value["status"].as_str(),
            value["taskId"].as_str(),
            value["error"].as_str(),
            source,
            id,
            run,
            value["projectId"].as_str()
        ],
    )
    .map_err(db_error)?;
    let previous = read(&tx, source, id, run)?;
    tx.commit().map_err(db_error)?;
    Ok(if previous == value {
        previous
    } else {
        Value::Null
    })
}
