use super::{CatalogError, db_error, string};
use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use serde_json::Value;
use std::sync::OnceLock;

fn sql(name: &str) -> Result<&'static str, CatalogError> {
    static SQL: OnceLock<Result<Value, serde_json::Error>> = OnceLock::new();
    string(
        SQL.get_or_init(|| {
            serde_json::from_str(include_str!(
                "../../../../../packages/protocol/src/acp-plan-state-sql.json"
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
fn integer(p: &Value, key: &str, min: i64) -> Result<i64, CatalogError> {
    p[key]
        .as_i64()
        .filter(|n| (*n >= min) && (*n <= 9_007_199_254_740_991))
        .ok_or(CatalogError::InvalidMessage)
}
fn time(p: &Value) -> Result<Option<i64>, CatalogError> {
    if p.get("nextRunAt") == Some(&Value::Null) {
        Ok(None)
    } else {
        integer(p, "nextRunAt", -9_007_199_254_740_991).map(Some)
    }
}
fn text<'a>(p: &'a Value, key: &str, max: usize) -> Result<&'a str, CatalogError> {
    let s = string(p, key)?;
    if s.is_empty() || s.encode_utf16().count() > max {
        return Err(CatalogError::InvalidMessage);
    }
    Ok(s)
}
fn optional<'a>(p: &'a Value, key: &str, max: usize) -> Result<Option<&'a str>, CatalogError> {
    if p.get(key) == Some(&Value::Null) {
        return Ok(None);
    }
    let s = string(p, key)?;
    if s.encode_utf16().count() > max {
        return Err(CatalogError::InvalidMessage);
    }
    Ok(Some(s))
}
fn read(db: &Connection, name: &str, args: impl rusqlite::Params) -> Result<Value, CatalogError> {
    read_query(db, sql(name)?, args)
}
fn history_sql(name: &str) -> Result<&'static str, CatalogError> {
    static SQL: OnceLock<Result<Value, serde_json::Error>> = OnceLock::new();
    string(
        SQL.get_or_init(|| {
            serde_json::from_str(include_str!(
                "../../../../../packages/protocol/src/acp-plan-history-sql.json"
            ))
        })
        .as_ref()
        .map_err(|_| CatalogError::InvalidMessage)?,
        name,
    )
}
fn read_query(
    db: &Connection,
    query: &str,
    args: impl rusqlite::Params,
) -> Result<Value, CatalogError> {
    let value: Option<String> = db
        .prepare_cached(query)
        .map_err(db_error)?
        .query_row(args, |r| r.get(0))
        .optional()
        .map_err(db_error)?;
    let parsed: Value = value
        .map(|s| serde_json::from_str(&s).map_err(|_| CatalogError::InvalidMessage))
        .unwrap_or(Ok(Value::Null))?;
    if let Some(definition) = parsed.get("definition")
        && !definition.is_null()
        && !super::acp_plan_validation::valid(definition)
    {
        return Err(CatalogError::InvalidMessage);
    }
    Ok(parsed)
}

/// 原生与 Web 使用同一组 SQL；领取、游标及执行快照共用立即事务。
pub(super) fn execute(db: &mut Connection, op: &str, p: &Value) -> Result<Value, CatalogError> {
    let source = string(p, "source")?;
    let id = text(p, "scheduleId", 256)?;
    if !matches!(source, "web" | "desktop") {
        return Err(CatalogError::InvalidMessage);
    }
    match op {
        // 历史只读取有限元数据，不能把仍被占用运行的完整快照送出目录层。
        "acp.plan.history" => read_query(db, history_sql("history")?, params![source, id]),
        "acp.plan.summary" => read_query(
            db,
            history_sql("summary")?,
            params![source, id, text(p, "runId", 256)?],
        ),
        "acp.plan.readState" => read(db, "readState", params![source, id]),
        "acp.plan.readRun" => read(db, "readRun", params![source, id, text(p, "runId", 256)?]),
        "acp.plan.arm" => arm(db, p),
        "acp.plan.claim" | "acp.plan.claimRef" => {
            let run = text(p, "runId", 256)?;
            let now = integer(p, "now", -9_007_199_254_740_991)?;
            let next = time(p)?;
            if next.is_some_and(|n| n <= now) {
                return Err(CatalogError::InvalidMessage);
            }
            let state = integer(p, "expectedStateRevision", 1)?;
            let revision = integer(p, "expectedRevision", 1)?;
            let tx = db
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(db_error)?;
            let updated = read(
                &tx,
                "claimCursor",
                params![next, source, id, state, revision, now],
            )?;
            if updated.is_null() {
                return Ok(Value::Null);
            }
            tx.execute(sql("prune")?, params![source, id])
                .map_err(db_error)?;
            tx.execute(sql("claimInsert")?, params![run, now, source, id])
                .map_err(db_error)?;
            let result = read(&tx, "readRun", params![source, id, run])?;
            tx.commit().map_err(db_error)?;
            Ok(if op == "acp.plan.claimRef" {
                serde_json::json!({"scheduleId":id,"runId":run})
            } else {
                result
            })
        }
        "acp.plan.finish" => {
            let run = text(p, "runId", 256)?;
            let expected = string(p, "expectedStatus")?;
            let status = string(p, "status")?;
            if !matches!(expected, "claimed" | "unknown")
                || !matches!(status, "started" | "failed" | "unknown")
            {
                return Err(CatalogError::InvalidMessage);
            }
            let task = optional(p, "taskId", 256)?;
            let error = optional(p, "error", 2048)?;
            if task == Some("")
                || (status == "started" && task.is_none())
                || (status != "started" && error.is_none())
            {
                return Err(CatalogError::InvalidMessage);
            }
            read(
                db,
                "finish",
                params![status, task, error, status, source, id, run, expected],
            )
        }
        _ => Err(CatalogError::InvalidMessage),
    }
}

/// 供原子提交复用；调用者负责事务，不能在这里开启嵌套事务。
pub(super) fn arm(db: &Connection, p: &Value) -> Result<Value, CatalogError> {
    let source = string(p, "source")?;
    let id = text(p, "scheduleId", 256)?;
    if !matches!(source, "web" | "desktop") {
        return Err(CatalogError::InvalidMessage);
    }
    let revision = integer(p, "expectedRevision", 1)?;
    let state = integer(p, "expectedStateRevision", 0)?;
    let next = time(p)?;
    if state == 0 {
        read(db, "armInsert", params![next, source, id, revision])
    } else {
        read(
            db,
            "armUpdate",
            params![revision, next, source, id, state, revision],
        )
    }
}
