use super::{CatalogError, db_error, string};
use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use serde_json::{Value, json};
use std::sync::OnceLock;

fn status(db: &Connection, p: &Value) -> Result<Value, CatalogError> {
    let source = string(p, "source")?;
    let id = string(p, "scheduleId")?;
    if !matches!(source, "web" | "desktop") || id.is_empty() || id.encode_utf16().count() > 256 {
        return Err(CatalogError::InvalidMessage);
    }
    static QUERIES: OnceLock<Result<Value, serde_json::Error>> = OnceLock::new();
    let queries = QUERIES
        .get_or_init(|| {
            serde_json::from_str(include_str!(
                "../../../../../packages/protocol/src/acp-plan-commit-sql.json"
            ))
        })
        .as_ref()
        .map_err(|_| CatalogError::InvalidMessage)?;
    let result: Option<String> = db
        .query_row(string(queries, "status")?, params![source, id], |r| {
            r.get(0)
        })
        .optional()
        .map_err(db_error)?;
    result
        .map(|r| serde_json::from_str(&r).map_err(|_| CatalogError::InvalidMessage))
        .unwrap_or(Ok(Value::Null))
}

fn view_bound(db: &Connection, p: &Value) -> Result<Value, CatalogError> {
    let mut plan = super::acp_scheduled_plans::execute(db, "acp.plan.read", p)?;
    if plan.is_null() {
        return Ok(plan);
    }
    let state = status(db, p)?;
    let resources = super::acp_plan_resources::list(
        db,
        &json!({"source":p["source"],"scheduleId":p["scheduleId"],"projectId":plan["definition"]["projectId"],"expectedRevision":plan["revision"]}),
    )?;
    plan["state"] = state["state"].clone();
    plan["canEdit"] = state["canEdit"].clone();
    plan["resources"] = resources;
    Ok(plan)
}

/// 定义、完整资源集合和调度游标使用同一立即事务；所有失败均由事务回滚。
pub(super) fn execute(db: &mut Connection, op: &str, p: &Value) -> Result<Value, CatalogError> {
    let behavior = if op == "acp.plan.view" {
        TransactionBehavior::Deferred
    } else {
        TransactionBehavior::Immediate
    };
    let tx = db.transaction_with_behavior(behavior).map_err(db_error)?;
    if op == "acp.plan.commit" {
        let expected = p["expectedStateRevision"]
            .as_i64()
            .filter(|n| (0..=9_007_199_254_740_991).contains(n))
            .ok_or(CatalogError::InvalidMessage)?;
        if (p["nextRunAt"] != Value::Null
            && p["nextRunAt"]
                .as_i64()
                .is_none_or(|n| !(-9_007_199_254_740_991..=9_007_199_254_740_991).contains(&n)))
            || p.get("nextRunAt").is_none()
            || (p["definition"]["enabled"] == false && p["nextRunAt"] != Value::Null)
        {
            return Err(CatalogError::InvalidMessage);
        }
        let before = status(&tx, p)?;
        if before["state"]["revision"].as_i64().unwrap_or(0) != expected
            || before["canEdit"] == false
        {
            return Ok(Value::Null);
        }
        let saved = super::acp_plan_resources::save_bound(&tx, p)?;
        if saved.is_null() {
            return Ok(Value::Null);
        }
        let mut arm = p.clone();
        arm["expectedRevision"] = saved["revision"].clone();
        if super::acp_plan_state::arm(&tx, &arm)?.is_null() {
            return Ok(Value::Null);
        }
    }
    let result = view_bound(&tx, p)?;
    tx.commit().map_err(db_error)?;
    Ok(result)
}
