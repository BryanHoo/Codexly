use super::{CatalogError, db_error, string};
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::{Value, json};
use std::sync::OnceLock;

fn sql(name: &str) -> Result<&'static str, CatalogError> {
    static SQL: OnceLock<Result<Value, serde_json::Error>> = OnceLock::new();
    string(
        SQL.get_or_init(|| {
            serde_json::from_str(include_str!(
                "../../../../../packages/protocol/src/acp-plan-index-sql.json"
            ))
        })
        .as_ref()
        .map_err(|_| CatalogError::InvalidMessage)?,
        name,
    )
}
pub(super) fn initialize(db: &Connection) -> Result<(), CatalogError> {
    // 已初始化的目录不再执行回填语句，避免重新遍历包含大段提示词的定义表。
    let exists = db
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE name='acp_plan_index_ready'",
            [],
            |_| Ok(()),
        )
        .optional()
        .map_err(db_error)?
        .is_some();
    if exists && db.query_row("SELECT 1 FROM acp_plan_index_ready WHERE id=1 AND EXISTS(SELECT 1 FROM sqlite_master WHERE name='acp_plan_index')", [], |_| Ok(())).optional().map_err(db_error)?.is_some() { return Ok(()); }
    db.execute_batch(sql("schema")?).map_err(db_error)
}
fn metadata(row: &rusqlite::Row<'_>) -> rusqlite::Result<Stored> {
    Ok((
        row.get(0)?,
        row.get(1)?,
        row.get(2)?,
        row.get(3)?,
        row.get(4)?,
        row.get(5)?,
        row.get(6)?,
    ))
}
type Stored = (
    String,
    String,
    i64,
    String,
    Option<i64>,
    Option<i64>,
    Option<i64>,
);
fn decode(
    (source, id, revision, text, state, scheduled, next): Stored,
) -> Result<Value, CatalogError> {
    let mut item: Value = serde_json::from_str(&text).map_err(|_| CatalogError::InvalidMessage)?;
    if !item.is_object() {
        return Err(CatalogError::InvalidMessage);
    }
    let mut check = item.clone();
    check["values"] = json!({});
    check["prompt"] = json!({"type":"prompt","text":"_","attachments":[],"skills":[]});
    if !super::acp_plan_validation::valid(&check) {
        return Err(CatalogError::InvalidMessage);
    }
    item["source"] = json!(source);
    item["scheduleId"] = json!(id);
    item["revision"] = json!(revision);
    item["stateRevision"] = json!(state);
    item["scheduledRevision"] = json!(scheduled);
    item["nextRunAt"] = json!(next);
    Ok(item)
}
/// 查询只读取小型投影和游标；提示词 / values 留在定义表，不参与列表与到期扫描。
pub(super) fn execute(db: &Connection, op: &str, p: &Value) -> Result<Value, CatalogError> {
    let source = string(p, "source")?;
    if !matches!(source, "web" | "desktop") {
        return Err(CatalogError::InvalidMessage);
    }
    if op == "acp.plan.nextDue" {
        let after = p["after"]
            .as_i64()
            .filter(|n| (-9_007_199_254_740_991..=9_007_199_254_740_991).contains(n))
            .ok_or(CatalogError::InvalidMessage)?;
        return Ok(json!(
            db.prepare_cached(sql("nextDue")?)
                .map_err(db_error)?
                .query_row(params![source, after], |r| r.get::<_, i64>(0))
                .optional()
                .map_err(db_error)?
        ));
    }
    let limit = p["limit"]
        .as_i64()
        .filter(|n| (1..=100).contains(n))
        .ok_or(CatalogError::InvalidMessage)?;
    if op == "acp.plan.active" {
        let after = match p.get("after") {
            None => "",
            Some(Value::String(s)) if s.encode_utf16().count() <= 256 => s,
            _ => return Err(CatalogError::InvalidMessage),
        };
        // 运行恢复只投影两个身份字段，不读取或复制不可变正文快照。
        let mut rows = db
            .prepare_cached(sql("active")?)
            .map_err(db_error)?
            .query_map(params![source, after, limit + 1], |r| {
                Ok(json!({"scheduleId":r.get::<_,String>(0)?,"runId":r.get::<_,String>(1)?}))
            })
            .map_err(db_error)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(db_error)?;
        let more = rows.len() > limit as usize;
        rows.truncate(limit as usize);
        let next = if more {
            rows.last()
                .map(|r| r["scheduleId"].clone())
                .unwrap_or(Value::Null)
        } else {
            Value::Null
        };
        return Ok(json!({"data":rows,"nextCursor":next}));
    }
    let rows = if op == "acp.plan.list" {
        let after = match p.get("after") {
            None => "",
            Some(Value::String(s)) if s.encode_utf16().count() <= 256 => s,
            _ => return Err(CatalogError::InvalidMessage),
        };
        db.prepare_cached(sql("list")?)
            .map_err(db_error)?
            .query_map(params![source, after, limit + 1], metadata)
            .map_err(db_error)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(db_error)?
    } else {
        let now = p["now"]
            .as_i64()
            .filter(|n| (-9_007_199_254_740_991..=9_007_199_254_740_991).contains(n))
            .ok_or(CatalogError::InvalidMessage)?;
        let after = p.get("after");
        let (after_time, after_id) = if let Some(after) = after {
            let time = after["nextRunAt"]
                .as_i64()
                .filter(|n| (-9_007_199_254_740_991..=9_007_199_254_740_991).contains(n))
                .ok_or(CatalogError::InvalidMessage)?;
            let id = string(after, "scheduleId")?;
            if id.is_empty() || id.encode_utf16().count() > 256 {
                return Err(CatalogError::InvalidMessage);
            }
            (Some(time), id)
        } else {
            (None, "")
        };
        db.prepare_cached(sql("due")?)
            .map_err(db_error)?
            .query_map(
                params![
                    source, now, after_time, after_time, after_time, after_id, limit
                ],
                metadata,
            )
            .map_err(db_error)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(db_error)?
    };
    let more = rows.len() > limit as usize;
    let data = rows
        .into_iter()
        .take(limit as usize)
        .map(decode)
        .collect::<Result<Vec<_>, _>>()?;
    if op == "acp.plan.due" {
        return Ok(json!(data));
    }
    let cursor = if more {
        data.last()
            .map(|v| v["scheduleId"].clone())
            .unwrap_or(Value::Null)
    } else {
        Value::Null
    };
    Ok(json!({"data":data,"nextCursor":cursor}))
}
