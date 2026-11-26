use super::{CatalogError, LocalCatalog, db_error, string};
use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::sync::OnceLock;
fn sql(name: &str) -> Result<&'static str, CatalogError> {
    static SQL: OnceLock<Result<Value, serde_json::Error>> = OnceLock::new();
    string(
        SQL.get_or_init(|| {
            serde_json::from_str(include_str!(
                "../../../../../packages/protocol/src/acp-plan-resource-sql.json"
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
fn text<'a>(p: &'a Value, key: &str, max: usize) -> Result<&'a str, CatalogError> {
    let s = string(p, key)?;
    if s.is_empty() || s.encode_utf16().count() > max {
        return Err(CatalogError::InvalidMessage);
    }
    Ok(s)
}
fn scope(p: &Value) -> Result<(&str, &str, &str), CatalogError> {
    let source = string(p, "source")?;
    if !matches!(source, "web" | "desktop") {
        return Err(CatalogError::InvalidMessage);
    }
    Ok((
        source,
        text(p, "scheduleId", 256)?,
        text(p, "projectId", 128)?,
    ))
}
fn metadata(a: &Value) -> Result<i64, CatalogError> {
    if a.as_object().is_none_or(|o| o.len() != 5) {
        return Err(CatalogError::InvalidMessage);
    }
    text(a, "id", 256)?;
    text(a, "name", 255)?;
    let mime = text(a, "mediaType", 255)?;
    let max = match string(a, "kind")? {
        "file" => 52428800,
        "text" if mime == "text/plain" => 1048576,
        "image"
            if matches!(
                mime,
                "image/png" | "image/jpeg" | "image/gif" | "image/webp"
            ) =>
        {
            10485760
        }
        _ => return Err(CatalogError::InvalidMessage),
    };
    a["size"]
        .as_i64()
        .filter(|n| (1..=max).contains(n))
        .ok_or(CatalogError::InvalidMessage)
}
struct Resource {
    token: String,
    attachment: Value,
    size: i64,
    written: i64,
    digest: Option<String>,
    revision: Option<i64>,
}
impl Resource {
    fn value(&self) -> Value {
        json!({"token":self.token,"attachment":self.attachment,"digest":self.digest,"written":self.written,"boundRevision":self.revision})
    }
}
fn read(db: &Connection, p: &Value) -> Result<Resource, CatalogError> {
    let (source, id, project) = scope(p)?;
    let token = text(p, "token", 128)?;
    let row = db
        .prepare_cached(sql("read")?)
        .map_err(db_error)?
        .query_row(params![token, source, id, project], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(4)?,
                r.get::<_, i64>(5)?,
                r.get::<_, i64>(6)?,
                r.get::<_, Option<String>>(7)?,
                r.get::<_, Option<i64>>(11)?,
            ))
        })
        .optional()
        .map_err(db_error)?
        .ok_or(CatalogError::InvalidMessage)?;
    let a: Value = serde_json::from_str(&row.1).map_err(|_| CatalogError::InvalidMessage)?;
    if metadata(&a)? != row.2 {
        return Err(CatalogError::InvalidMessage);
    }
    Ok(Resource {
        token: row.0,
        attachment: a,
        size: row.2,
        written: row.3,
        digest: row.4,
        revision: row.5,
    })
}
fn hash(bytes: &[u8]) -> String {
    crate::encoding::encode_lower_hex(Sha256::digest(bytes))
}
fn append(db: &mut Connection, p: &Value, offset: i64, bytes: &[u8]) -> Result<i64, CatalogError> {
    // 锁内核对游标与摘要；网络重试只能重复同一块，不能覆盖已经写入的内容。
    let tx = db
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(db_error)?;
    let r = read(&tx, p)?;
    if r.digest.is_some() || bytes.is_empty() || bytes.len() > 262144 || offset < 0 {
        return Err(CatalogError::InvalidMessage);
    }
    let digest = hash(bytes);
    if offset < r.written {
        let old = tx
            .query_row(sql("chunk")?, params![r.token, offset], |r| {
                Ok((r.get::<_, Vec<u8>>(0)?, r.get::<_, String>(1)?))
            })
            .optional()
            .map_err(db_error)?;
        if old.is_none_or(|(content, old)| content.len() != bytes.len() || old != digest) {
            return Err(CatalogError::InvalidMessage);
        }
        return Ok(r.written);
    }
    if offset != r.written || offset + bytes.len() as i64 > r.size {
        return Err(CatalogError::InvalidMessage);
    }
    tx.execute(sql("append")?, params![r.token, offset, bytes, digest])
        .map_err(db_error)?;
    tx.execute(
        sql("advance")?,
        params![bytes.len() as i64, r.token, offset],
    )
    .map_err(db_error)?;
    tx.commit().map_err(db_error)?;
    Ok(r.written + bytes.len() as i64)
}
fn chunk(db: &Connection, p: &Value, offset: i64) -> Result<Option<Vec<u8>>, CatalogError> {
    let r = read(db, p)?;
    if r.digest.is_none() || offset < 0 || offset > r.size {
        return Err(CatalogError::InvalidMessage);
    }
    if offset == r.size {
        return Ok(None);
    }
    let (content, digest) = db
        .query_row(sql("chunk")?, params![r.token, offset], |r| {
            Ok((r.get::<_, Vec<u8>>(0)?, r.get::<_, String>(1)?))
        })
        .map_err(db_error)?;
    if content.len() as i64 > r.size - offset || hash(&content) != digest {
        return Err(CatalogError::InvalidMessage);
    }
    Ok(Some(content))
}
impl LocalCatalog {
    /// 原始字节直接进入阻塞数据库线程，避免 JSON 数字数组或 Base64 的复制开销。
    pub async fn append_plan_resource(
        &self,
        key: Value,
        offset: i64,
        content: Vec<u8>,
    ) -> Result<i64, CatalogError> {
        let store = self.clone();
        tokio::task::spawn_blocking(move || {
            store.with_database(|db| append(db, &key, offset, &content))
        })
        .await
        .map_err(|_| CatalogError::StateUnavailable)?
    }
    pub async fn read_plan_resource_chunk(
        &self,
        key: Value,
        offset: i64,
    ) -> Result<Option<Vec<u8>>, CatalogError> {
        let store = self.clone();
        tokio::task::spawn_blocking(move || store.with_database(|db| chunk(db, &key, offset)))
            .await
            .map_err(|_| CatalogError::StateUnavailable)?
    }
}
fn seal(db: &mut Connection, p: &Value) -> Result<Value, CatalogError> {
    // 文件按块校验，不整体载入内存；文本额外校验 UTF-8，容量上限为 1 MiB。
    let tx = db
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(db_error)?;
    let r = read(&tx, p)?;
    if r.digest.is_some() {
        return Ok(r.value());
    }
    if r.written != r.size {
        return Err(CatalogError::InvalidMessage);
    }
    let mut hasher = Sha256::new();
    let mut offset = 0;
    let mut text = Vec::new();
    let is_text = r.attachment["kind"] == "text";
    {
        let mut statement = tx.prepare_cached(sql("chunks")?).map_err(db_error)?;
        let rows = statement
            .query_map([&r.token], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, Vec<u8>>(1)?,
                    r.get::<_, String>(2)?,
                ))
            })
            .map_err(db_error)?;
        for row in rows {
            let (at, bytes, digest) = row.map_err(db_error)?;
            if at != offset || offset + bytes.len() as i64 > r.size || hash(&bytes) != digest {
                return Err(CatalogError::InvalidMessage);
            }
            offset += bytes.len() as i64;
            hasher.update(&bytes);
            if is_text {
                text.extend_from_slice(&bytes);
            }
        }
    }
    if offset != r.size || (is_text && std::str::from_utf8(&text).is_err()) {
        return Err(CatalogError::InvalidMessage);
    }
    tx.execute(
        sql("seal")?,
        params![
            crate::encoding::encode_lower_hex(hasher.finalize()),
            r.token
        ],
    )
    .map_err(db_error)?;
    let value = read(&tx, p)?.value();
    tx.commit().map_err(db_error)?;
    Ok(value)
}
fn save(db: &mut Connection, p: &Value) -> Result<Value, CatalogError> {
    let tx = db
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(db_error)?;
    let plan = save_bound(&tx, p)?;
    if !plan.is_null() {
        tx.commit().map_err(db_error)?;
    }
    Ok(plan)
}
pub(super) fn save_bound(db: &Connection, p: &Value) -> Result<Value, CatalogError> {
    // 定义 CAS、完整引用集合、资源绑定及旧块回收必须共同提交，失败时全部回滚。
    let tokens = p["resources"]
        .as_array()
        .filter(|t| t.len() <= 1500)
        .ok_or(CatalogError::InvalidMessage)?;
    let mut token_set = std::collections::HashSet::new();
    for token in tokens {
        if !token_set.insert(token.as_str().ok_or(CatalogError::InvalidMessage)?) {
            return Err(CatalogError::InvalidMessage);
        }
    }
    let scoped = json!({"source":p["source"],"scheduleId":p["scheduleId"],"projectId":p["definition"]["projectId"]});
    let (source, id, project) = scope(&scoped)?;
    let refs = p["definition"]["prompt"]["attachments"]
        .as_array()
        .ok_or(CatalogError::InvalidMessage)?;
    let mut ids = std::collections::HashSet::new();
    for item in refs {
        if !ids.insert(string(item, "id")?) {
            return Err(CatalogError::InvalidMessage);
        }
    }
    if refs.len() != tokens.len() {
        return Err(CatalogError::InvalidMessage);
    }
    let mut image_bytes = 0;
    let mut file_bytes = 0;
    let mut images = 0;
    for token in tokens {
        let input = json!({"source":source,"scheduleId":id,"projectId":project,"token":token});
        let r = read(db, &input)?;
        if r.digest.is_none() || !ids.remove(string(&r.attachment, "id")?) {
            return Err(CatalogError::InvalidMessage);
        }
        if r.attachment["kind"] == "image" {
            images += 1;
            image_bytes += r.size;
        } else {
            file_bytes += r.size;
        }
    }
    if !ids.is_empty() || images > 20 || image_bytes > 52428800 || file_bytes > 52428800 {
        return Err(CatalogError::InvalidMessage);
    }
    let plan = super::acp_scheduled_plans::execute(db, "acp.plan.set", p)?;
    if plan.is_null() {
        return Ok(plan);
    }
    db.execute(
        sql("prune")?,
        params![
            source,
            id,
            serde_json::to_string(tokens).map_err(|_| CatalogError::InvalidMessage)?
        ],
    )
    .map_err(db_error)?;
    for token in tokens {
        db.execute(
            sql("bind")?,
            params![
                plan["revision"].as_i64(),
                token.as_str(),
                source,
                id,
                project
            ],
        )
        .map_err(db_error)?;
    }
    Ok(plan)
}
pub(super) fn execute(db: &mut Connection, op: &str, p: &Value) -> Result<Value, CatalogError> {
    if op == "acp.plan.save" {
        return save(db, p);
    }
    if op == "acp.resource.seal" {
        return seal(db, p);
    }
    if op == "acp.resource.list" {
        return list(db, p);
    }
    let (source, id, project) = scope(p)?;
    let token = text(p, "token", 128)?;
    if op == "acp.resource.abort" {
        return Ok(json!(
            db.execute(sql("abort")?, params![token, source, id, project])
                .map_err(db_error)?
                > 0
        ));
    }
    if op != "acp.resource.begin" {
        return Err(CatalogError::InvalidMessage);
    }
    let size = metadata(&p["attachment"])?;
    let tx = db
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(db_error)?;
    let exists = tx
        .query_row(
            sql("read")?,
            params![token, source, id, project],
            |_| Ok(()),
        )
        .optional()
        .map_err(db_error)?
        .is_some();
    if exists {
        let r = read(&tx, p)?;
        if r.attachment != p["attachment"] {
            return Err(CatalogError::InvalidMessage);
        }
        return Ok(r.value());
    }
    let now = chrono::Utc::now().timestamp_millis();
    tx.execute(sql("expire")?, [now - 86400000])
        .map_err(db_error)?;
    tx.execute(
        sql("begin")?,
        params![
            token,
            source,
            id,
            project,
            serde_json::to_string(&p["attachment"]).map_err(|_| CatalogError::InvalidMessage)?,
            size,
            now
        ],
    )
    .map_err(db_error)?;
    let result = read(&tx, p)?.value();
    tx.commit().map_err(db_error)?;
    Ok(result)
}

pub(super) fn list(db: &Connection, p: &Value) -> Result<Value, CatalogError> {
    let (source, id, project) = scope(p)?;
    let revision = p["expectedRevision"]
        .as_i64()
        .filter(|n| (1..=9_007_199_254_740_991).contains(n))
        .ok_or(CatalogError::InvalidMessage)?;
    let mut statement = db.prepare_cached(sql("list")?).map_err(db_error)?;
    let tokens = statement
        .query_map(params![source, id, project, revision], |r| {
            r.get::<_, String>(0)
        })
        .map_err(db_error)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(db_error)?;
    let mut data = Vec::new();
    for token in tokens {
        let mut key = p.clone();
        key["token"] = json!(token);
        data.push(read(db, &key)?.value());
    }
    Ok(json!(data))
}
