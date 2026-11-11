use super::{CatalogError, db_error, string};
use rusqlite::{Connection, OptionalExtension, Row, params};
use serde_json::{Value, json};
use std::sync::OnceLock;

const MAX_REVISION: i64 = 9_007_199_254_740_991;
type StoredConfig = (String, String, String, String, i64);

fn sql(name: &str) -> Result<&'static str, CatalogError> {
    // 编译内嵌并只解析一次；两端使用同一份 SQL，不能分别修改 CAS 或预算语义。
    static SQL: OnceLock<Result<Value, serde_json::Error>> = OnceLock::new();
    let value = SQL
        .get_or_init(|| {
            serde_json::from_str(include_str!(
                "../../../../../packages/protocol/src/acp-scheduled-config-sql.json"
            ))
        })
        .as_ref()
        .map_err(|_| CatalogError::InvalidMessage)?;
    string(value, name)
}

pub(super) fn initialize(db: &Connection) -> Result<(), CatalogError> {
    // 私有增量表不提升共享 user_version，也不改旧 JSON 计划及其运行记录。
    db.execute_batch(sql("schema")?).map_err(db_error)
}

fn valid_length(text: &str, maximum: usize) -> bool {
    // 与 JS 字符串长度一致，非 BMP 字符占两个 UTF-16 单元；扫描达到上限即停止。
    text.encode_utf16().take(maximum + 1).count() <= maximum
}

fn key(input: &Value) -> Result<(&str, &str), CatalogError> {
    let source = string(input, "source")?;
    let id = string(input, "scheduleId")?;
    if !matches!(source, "web" | "desktop") || id.is_empty() || !valid_length(id, 256) {
        return Err(CatalogError::InvalidMessage);
    }
    Ok((source, id))
}

fn revision(input: &Value) -> Result<i64, CatalogError> {
    input["expectedRevision"]
        .as_i64()
        .filter(|value| (0..=MAX_REVISION).contains(value))
        .ok_or(CatalogError::InvalidMessage)
}

fn encode(input: &Value) -> Result<String, CatalogError> {
    if !matches!(string(input, "engine")?, "codex" | "claude") {
        return Err(CatalogError::InvalidMessage);
    }
    let values = input["values"]
        .as_object()
        .ok_or(CatalogError::InvalidMessage)?;
    for (name, value) in values {
        if name.is_empty()
            || !valid_length(name, 256)
            || !(value.is_boolean()
                || value
                    .as_str()
                    .is_some_and(|text| valid_length(text, 16_384)))
        {
            return Err(CatalogError::InvalidMessage);
        }
    }
    let text = serde_json::to_string(values).map_err(|_| CatalogError::InvalidMessage)?;
    if text.len() > 262_144 {
        return Err(CatalogError::InvalidMessage);
    }
    Ok(text)
}

fn row(row: &Row<'_>) -> rusqlite::Result<StoredConfig> {
    Ok((
        row.get(0)?,
        row.get(1)?,
        row.get(2)?,
        row.get(3)?,
        row.get(4)?,
    ))
}

fn record(stored: Option<StoredConfig>) -> Result<Value, CatalogError> {
    let Some((source, id, engine, text, revision)) = stored else {
        return Ok(Value::Null);
    };
    let values: Value = serde_json::from_str(&text).map_err(|_| CatalogError::InvalidMessage)?;
    let value = json!({"source":source,"scheduleId":id,"engine":engine,"values":values,"revision":revision});
    // 读取同样校验原始选项；配置损坏必须失败，不能偷偷使用更宽松的全局权限。
    key(&value)?;
    encode(&value)?;
    if !(1..=MAX_REVISION).contains(&revision) {
        return Err(CatalogError::InvalidMessage);
    }
    Ok(value)
}

pub(super) fn execute(db: &Connection, op: &str, input: &Value) -> Result<Value, CatalogError> {
    let (source, id) = key(input)?;
    match op {
        "acp.schedule.read" => record(
            db.prepare_cached(sql("read")?)
                .map_err(db_error)?
                .query_row(params![source, id], row)
                .optional()
                .map_err(db_error)?,
        ),
        "acp.schedule.set" => {
            let expected = revision(input)?;
            let text = encode(input)?;
            let engine = string(input, "engine")?;
            // 修订检查和写入由单条 SQL 完成，多窗口及 Web/桌面并发都不能覆盖新值。
            let stored = if expected == 0 {
                db.prepare_cached(sql("insert")?)
                    .map_err(db_error)?
                    .query_row(params![source, id, engine, text, expected], row)
            } else {
                db.prepare_cached(sql("update")?)
                    .map_err(db_error)?
                    .query_row(params![engine, text, source, id, expected], row)
            };
            record(stored.optional().map_err(db_error)?)
        }
        "acp.schedule.delete" => Ok(json!(
            db.prepare_cached(sql("delete")?)
                .map_err(db_error)?
                .execute(params![source, id, revision(input)?])
                .map_err(db_error)?
                > 0
        )),
        _ => Err(CatalogError::InvalidMessage),
    }
}
