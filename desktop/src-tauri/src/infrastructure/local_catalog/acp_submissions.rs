use super::{CatalogError, db_error, string};
use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use serde_json::{Value, json};

pub(super) fn initialize(db: &mut Connection) -> Result<(), CatalogError> {
    // 多进程首次升级也在同一写事务检查列，避免同时 ALTER 导致一端初始化失败。
    let tx = db
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(db_error)?;
    // 原生提交账本独立于厂商配置；与任务同库，删除任务时同步回收，无额外后台线程。
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS native_acp_submissions (
      project_id TEXT NOT NULL, submission_key TEXT NOT NULL, task_id TEXT NOT NULL,
      fingerprint TEXT NOT NULL, result_json TEXT, updated_at INTEGER NOT NULL,
      PRIMARY KEY(project_id,submission_key)) STRICT;
      CREATE INDEX IF NOT EXISTS native_acp_submissions_task ON native_acp_submissions(task_id);
      CREATE TRIGGER IF NOT EXISTS delete_native_acp_submissions AFTER DELETE ON managed_tasks
      BEGIN DELETE FROM native_acp_submissions WHERE task_id=OLD.id; END;",
    )
    .map_err(db_error)?;
    let reserved: Option<i64> = tx
        .query_row(
            "SELECT 1 FROM pragma_table_info('native_acp_submissions') WHERE name='reserved'",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(db_error)?;
    if reserved.is_none() {
        // 旧未完成记录缺省仍视为已发送，升级不能把未知结果误判成可重试。
        tx.execute_batch("ALTER TABLE native_acp_submissions ADD COLUMN reserved INTEGER NOT NULL DEFAULT 1 CHECK(reserved IN (0,1));").map_err(db_error)?;
    }
    tx.commit().map_err(db_error)
}

pub(super) fn execute(db: &mut Connection, op: &str, p: &Value) -> Result<Value, CatalogError> {
    if op == "acp.submission.inspect" {
        return inspect(db, p);
    }
    let project = string(p, "projectId")?;
    let task = string(p, "taskId")?;
    let key = string(p, "key")?;
    let fingerprint = string(p, "fingerprint")?;
    if project.len() > 1024
        || task.len() > 1024
        || key.len() > 128
        || fingerprint.len() > 256
        || project.is_empty()
        || task.is_empty()
        || key.trim().is_empty()
        || fingerprint.is_empty()
    {
        return Err(CatalogError::InvalidMessage);
    }
    let tx = db
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(db_error)?;
    let current: Option<(String, String, Option<String>, i64)> = tx.query_row(
        "SELECT task_id,fingerprint,result_json,reserved FROM native_acp_submissions WHERE project_id=? AND submission_key=?",
        params![project,key], |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?)))
        .optional().map_err(db_error)?;
    if let Some((stored_task, stored_fingerprint, _, _)) = &current
        && (stored_task != task || stored_fingerprint != fingerprint)
    {
        return Ok(json!({"status":"conflict"}));
    }
    let now = chrono::Utc::now().timestamp_millis();
    let response = match op {
        "acp.submission.recover" => {
            if let Some((_, _, result, reserved)) = current {
                match result {
                    Some(result) => {
                        json!({"status":"completed","result":serde_json::from_str::<Value>(&result).map_err(|_|CatalogError::StateUnavailable)?})
                    }
                    None if reserved == 0 => json!({"status":"available"}),
                    None => json!({"status":"unknown"}),
                }
            } else {
                let source = string(p, "sourceKey")?;
                if source.trim().is_empty() || source.len() > 128 || source == key {
                    return Err(CatalogError::InvalidMessage);
                }
                let available:Option<i64>=tx.query_row("SELECT 1 FROM native_acp_submissions WHERE project_id=? AND submission_key=? AND task_id=? AND result_json IS NULL AND reserved=0",params![project,source,task],|row|row.get(0)).optional().map_err(db_error)?;
                if available.is_none() {
                    return Ok(json!({"status":"unknown"}));
                }
                tx.execute("DELETE FROM native_acp_submissions WHERE result_json IS NOT NULL AND updated_at<?",[now-7*24*60*60*1000]).map_err(db_error)?;
                let count: i64 = tx
                    .query_row("SELECT COUNT(*) FROM native_acp_submissions", [], |row| {
                        row.get(0)
                    })
                    .map_err(db_error)?;
                if count >= 10000 {
                    return Err(CatalogError::StateUnavailable);
                }
                // 转交后旧入口保持未知，新入口仍未发送；两个修改共用当前 Immediate 事务。
                tx.execute("INSERT INTO native_acp_submissions(project_id,submission_key,task_id,fingerprint,result_json,updated_at,reserved) VALUES(?,?,?,?,NULL,?,0)",params![project,key,task,fingerprint,now]).map_err(db_error)?;
                tx.execute("UPDATE native_acp_submissions SET reserved=1 WHERE project_id=? AND submission_key=?",params![project,source]).map_err(db_error)?;
                json!({"status":"available"})
            }
        }
        "acp.submission.retry" => {
            // 此操作仅由原生代码在收到宿主的固定未提交错误码时调用，不能暴露给前端。
            if matches!(current, Some((_, _, None, _))) {
                tx.execute(
                    "UPDATE native_acp_submissions SET reserved=0 WHERE project_id=? AND submission_key=?",
                    params![project, key],
                )
                .map_err(db_error)?;
            }
            json!({"status":"available"})
        }
        "acp.submission.read" => match current {
            Some((_, _, Some(result), _)) => {
                json!({"status":"completed","result":serde_json::from_str::<Value>(&result).map_err(|_|CatalogError::StateUnavailable)?})
            }
            Some((_, _, None, 0)) => json!({"status":"available"}),
            Some(_) => json!({"status":"unknown"}),
            None => json!({"status":"available"}),
        },
        "acp.submission.begin" | "acp.submission.prepare" => match current {
            Some((_, _, Some(result), _)) => {
                json!({"status":"completed","result":serde_json::from_str::<Value>(&result).map_err(|_|CatalogError::StateUnavailable)?})
            }
            Some((_, _, None, 0)) => {
                if op == "acp.submission.prepare" {
                    return Ok(json!({"status":"available"}));
                }
                // 只切换发送状态，始终保留原指纹；安全重试也不能换正文或任务。
                tx.execute("UPDATE native_acp_submissions SET reserved=1 WHERE project_id=? AND submission_key=?",params![project,key]).map_err(db_error)?;
                json!({"status":"reserved"})
            }
            Some(_) => json!({"status":"unknown"}),
            None => {
                // 只淘汰七天前的完成项；未知状态永久保留，不能因容量回收再次发送。
                tx.execute("DELETE FROM native_acp_submissions WHERE result_json IS NOT NULL AND updated_at<?",[now-7*24*60*60*1000]).map_err(db_error)?;
                let count: i64 = tx
                    .query_row("SELECT COUNT(*) FROM native_acp_submissions", [], |row| {
                        row.get(0)
                    })
                    .map_err(db_error)?;
                if count >= 10_000 {
                    return Err(CatalogError::StateUnavailable);
                }
                tx.execute(
                    "INSERT INTO native_acp_submissions(project_id,submission_key,task_id,fingerprint,result_json,updated_at,reserved) VALUES(?,?,?,?,NULL,?,?)",
                    params![project, key, task, fingerprint, now, op == "acp.submission.begin"],
                )
                .map_err(db_error)?;
                json!({"status":if op == "acp.submission.prepare" {"available"}else{"reserved"}})
            }
        },
        "acp.submission.complete" => {
            if current.is_none() || !p["result"].is_object() {
                return Err(CatalogError::InvalidMessage);
            }
            let result =
                serde_json::to_string(&p["result"]).map_err(|_| CatalogError::InvalidMessage)?;
            let bytes: i64 = tx
                .query_row(
                    "SELECT COALESCE(SUM(length(CAST(result_json AS BLOB))),0) FROM native_acp_submissions",
                    [],
                    |row| row.get(0),
                )
                .map_err(db_error)?;
            if result.len() > 8 * 1024 * 1024 || bytes + result.len() as i64 > 64 * 1024 * 1024 {
                return Err(CatalogError::StateUnavailable);
            }
            // 完成结果不可改写；重复收尾只有内容相同才允许。
            if let Some((_, _, Some(stored), _)) = current {
                if stored != result {
                    return Ok(json!({"status":"conflict"}));
                }
            } else {
                tx.execute("UPDATE native_acp_submissions SET result_json=?,updated_at=? WHERE project_id=? AND submission_key=?",params![result,now,project,key]).map_err(db_error)?;
            }
            json!({"status":"completed"})
        }
        _ => return Err(CatalogError::InvalidMessage),
    };
    tx.commit().map_err(db_error)?;
    Ok(response)
}

fn inspect(db: &Connection, p: &Value) -> Result<Value, CatalogError> {
    let project = string(p, "projectId")?;
    let task = string(p, "taskId")?;
    let key = string(p, "key")?;
    if project.is_empty()
        || project.len() > 1024
        || task.is_empty()
        || task.len() > 1024
        || key.trim().is_empty()
        || key.len() > 128
    {
        return Err(CatalogError::InvalidMessage);
    }
    // 只读元数据，不取回完整回合；损坏完成记录不得被投影成成功，更不能清除原占用。
    let current: Option<(String, bool, i64, bool)> = db.query_row(
        "SELECT task_id,result_json IS NOT NULL,reserved,CASE WHEN result_json IS NULL THEN 1 WHEN json_valid(result_json) THEN json_type(result_json)='object' AND json_type(result_json,'$.id')='text' AND length(json_extract(result_json,'$.id'))>0 ELSE 0 END FROM native_acp_submissions WHERE project_id=? AND submission_key=?",
        params![project,key], |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?)),
    ).optional().map_err(db_error)?;
    let status = match current {
        None => "absent",
        Some((stored, _, _, _)) if stored != task => "conflict",
        Some((_, _, _, false)) => return Err(CatalogError::StateUnavailable),
        Some((_, true, _, _)) => "completed",
        Some((_, false, 0, _)) => "available",
        Some(_) => "unknown",
    };
    Ok(json!({"status":status}))
}

#[cfg(test)]
mod recovery_tests {
    use super::*;
    fn fixture() -> Connection {
        let mut db = Connection::open_in_memory().unwrap();
        db.execute_batch("CREATE TABLE managed_tasks(id TEXT PRIMARY KEY);")
            .unwrap();
        initialize(&mut db).unwrap();
        db
    }
    fn request(key: &str) -> Value {
        json!({"projectId":"p","taskId":"t","key":key,"fingerprint":format!("fp-{key}")})
    }
    #[test]
    fn recovery_should_transfer_only_known_unsubmitted_identity() {
        let mut db = fixture();
        let old = request("old");
        execute(&mut db, "acp.submission.begin", &old).unwrap();
        execute(&mut db, "acp.submission.retry", &old).unwrap();
        let mut next = request("next");
        next["sourceKey"] = json!("old");
        assert_eq!(
            execute(&mut db, "acp.submission.recover", &next).unwrap()["status"],
            "available"
        );
        assert_eq!(
            execute(&mut db, "acp.submission.read", &old).unwrap()["status"],
            "unknown"
        );
        assert_eq!(
            execute(&mut db, "acp.submission.begin", &next).unwrap()["status"],
            "reserved"
        );
        let mut competing = request("competing");
        competing["sourceKey"] = json!("old");
        assert_eq!(
            execute(&mut db, "acp.submission.recover", &competing).unwrap()["status"],
            "unknown"
        );
    }
    #[test]
    fn recovery_should_reject_unknown_result_or_other_task() {
        let mut db = fixture();
        let old = request("old");
        execute(&mut db, "acp.submission.begin", &old).unwrap();
        let mut next = request("next");
        next["sourceKey"] = json!("old");
        assert_eq!(
            execute(&mut db, "acp.submission.recover", &next).unwrap()["status"],
            "unknown"
        );
        execute(&mut db, "acp.submission.retry", &old).unwrap();
        next["taskId"] = json!("other");
        assert_eq!(
            execute(&mut db, "acp.submission.recover", &next).unwrap()["status"],
            "unknown"
        );
    }
}
