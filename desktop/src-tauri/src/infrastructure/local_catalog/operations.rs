use super::*;
use rusqlite::{params, types::Value as SqlValue};

fn read(db: &Connection, table: &str, id: &str) -> Result<Value, CatalogError> {
    let mapper = if table == "managed_projects" {
        project
    } else {
        task
    };
    db.query_row(&format!("SELECT * FROM {table} WHERE id=?"), [id], mapper)
        .optional()
        .map(|v| v.unwrap_or(Value::Null))
        .map_err(db_error)
}
fn projects(db: &Connection) -> Result<Value, CatalogError> {
    let mut statement = db
        .prepare_cached("SELECT * FROM managed_projects ORDER BY position,id")
        .map_err(db_error)?;
    let values = statement
        .query_map([], project)
        .map_err(db_error)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(db_error)?;
    Ok(json!(values))
}
fn put_project(db: &Connection, p: &Value) -> Result<Value, CatalogError> {
    db.execute("INSERT INTO managed_projects VALUES (?,?,?,?,(SELECT COALESCE(MAX(position)+1,0) FROM managed_projects)) ON CONFLICT(id) DO UPDATE SET name=excluded.name,path=excluded.path",
        params![string(p,"id")?,string(p,"name")?,string(p,"path")?,string(p,"createdAt")?]).map_err(db_error)?;
    read(db, "managed_projects", string(p, "id")?)
}
fn put_task(db: &Connection, t: &Value) -> Result<Value, CatalogError> {
    assert_immutable_binding(&read(db, "managed_tasks", string(t, "id")?)?, t)?;
    db.execute(
        "INSERT INTO managed_tasks VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING",
        params![
            string(t, "id")?,
            t["projectId"].as_str(),
            string(t, "title")?,
            string(t, "cwd")?,
            string(t, "provider")?,
            t["sessionId"].as_str(),
            t["updatedAt"]
                .as_f64()
                .ok_or(CatalogError::InvalidMessage)?,
            t["pinned"] == true,
            t["archived"] == true,
            string(t, "status")?
        ],
    )
    .map_err(db_error)?;
    read(db, "managed_tasks", string(t, "id")?)
}

fn assert_immutable_binding(current: &Value, candidate: &Value) -> Result<(), CatalogError> {
    if current.is_null() {
        return Ok(());
    }
    // 与 Web Worker 保持一致：首次绑定允许写入，同值重放允许，改绑必须显式失败。
    for key in ["provider", "projectId", "sessionId"] {
        if key == "sessionId" && current[key].is_null() {
            continue;
        }
        if let Some(value) = candidate.get(key)
            && value != &current[key]
        {
            return Err(CatalogError::ImmutableBinding);
        }
    }
    Ok(())
}

pub(super) fn execute(db: &mut Connection, op: &str, p: &Value) -> Result<Value, CatalogError> {
    match op {
        "project.list" => projects(db),
        "project.read" => read(db, "managed_projects", string(p, "id")?),
        "project.put" => put_project(db, p),
        "project.rename" => {
            let name = string(p, "name")?.trim();
            if name.is_empty() {
                return Err(CatalogError::InvalidMessage);
            }
            db.execute(
                "UPDATE managed_projects SET name=? WHERE id=?",
                params![name, string(p, "id")?],
            )
            .map_err(db_error)?;
            read(db, "managed_projects", string(p, "id")?)
        }
        "project.remove" => {
            let active = db
                .query_row(
                    "SELECT 1 FROM managed_tasks WHERE project_id=? AND status='active' LIMIT 1",
                    [string(p, "id")?],
                    |r| r.get::<_, i64>(0),
                )
                .optional()
                .map_err(db_error)?;
            if active.is_some() {
                return Err(CatalogError::TaskRunning);
            }
            Ok(json!(
                db.execute(
                    "DELETE FROM managed_projects WHERE id=?",
                    [string(p, "id")?]
                )
                .map_err(db_error)?
                    > 0
            ))
        }
        "project.reorder" => {
            let ids = p["ids"].as_array().ok_or(CatalogError::InvalidMessage)?;
            let current = projects(db)?;
            let current = current.as_array().ok_or(CatalogError::InvalidMessage)?;
            let unique = ids
                .iter()
                .filter_map(Value::as_str)
                .collect::<std::collections::HashSet<_>>();
            if ids.len() != current.len()
                || unique.len() != ids.len()
                || current
                    .iter()
                    .any(|v| !unique.contains(v["id"].as_str().unwrap_or_default()))
            {
                return Err(CatalogError::InvalidMessage);
            }
            let transaction = db.transaction().map_err(db_error)?;
            for (position, id) in ids.iter().enumerate() {
                transaction
                    .execute(
                        "UPDATE managed_projects SET position=? WHERE id=?",
                        params![position as i64, id.as_str()],
                    )
                    .map_err(db_error)?;
            }
            transaction.commit().map_err(db_error)?;
            projects(db)
        }
        "task.put" => put_task(db, p),
        "task.read" => read(db, "managed_tasks", string(p, "id")?),
        "task.bindings" => {
            let mut statement = db
                .prepare_cached("SELECT * FROM managed_tasks")
                .map_err(db_error)?;
            Ok(json!(
                statement
                    .query_map([], task)
                    .map_err(db_error)?
                    .collect::<rusqlite::Result<Vec<_>>>()
                    .map_err(db_error)?
            ))
        }
        "task.patch" => {
            let mut next = read(db, "managed_tasks", string(p, "id")?)?;
            if next.is_null() {
                return Err(CatalogError::InvalidMessage);
            }
            assert_immutable_binding(&next, p)?;
            if next["provider"] == "claude" && next["status"] == "active" && p["archived"] == true {
                return Err(CatalogError::TaskRunning);
            }
            for key in [
                "title",
                "cwd",
                "sessionId",
                "updatedAt",
                "pinned",
                "archived",
                "status",
            ] {
                if let Some(value) = p.get(key)
                    && (key != "sessionId" || next[key].is_null())
                {
                    next[key] = value.clone();
                }
            }
            if p.get("title").is_some() {
                let title = string(&next, "title")?.trim().to_owned();
                if title.is_empty() {
                    return Err(CatalogError::InvalidMessage);
                }
                next["title"] = json!(title);
            }
            db.execute("UPDATE managed_tasks SET title=?,cwd=?,session_id=?,updated_at=?,pinned=?,archived=?,status=? WHERE id=?",
                params![string(&next,"title")?,string(&next,"cwd")?,next["sessionId"].as_str(),next["updatedAt"].as_f64(),next["pinned"]==true,next["archived"]==true,string(&next,"status")?,string(&next,"id")?]).map_err(db_error)?;
            Ok(next)
        }
        "task.remove" => {
            if read(db, "managed_tasks", string(p, "id")?)?["status"] == "active" {
                return Err(CatalogError::TaskRunning);
            }
            Ok(json!(
                db.execute("DELETE FROM managed_tasks WHERE id=?", [string(p, "id")?])
                    .map_err(db_error)?
                    > 0
            ))
        }
        "task.list" => list_tasks(db, p),
        "migration.done" => Ok(json!(
            db.query_row(
                "SELECT 1 FROM managed_catalog_migration WHERE id=1",
                [],
                |r| r.get::<_, i64>(0)
            )
            .optional()
            .map_err(db_error)?
            .is_some()
        )),
        "migration.import" => {
            let transaction = db.transaction().map_err(db_error)?;
            if transaction
                .query_row(
                    "SELECT 1 FROM managed_catalog_migration WHERE id=1",
                    [],
                    |r| r.get::<_, i64>(0),
                )
                .optional()
                .map_err(db_error)?
                .is_some()
            {
                return Ok(Value::Null);
            }
            for project in p["projects"]
                .as_array()
                .ok_or(CatalogError::InvalidMessage)?
            {
                put_project(&transaction, project)?;
            }
            for task in p["tasks"].as_array().ok_or(CatalogError::InvalidMessage)? {
                put_task(&transaction, task)?;
            }
            transaction
                .execute("INSERT INTO managed_catalog_migration VALUES (1)", [])
                .map_err(db_error)?;
            transaction.commit().map_err(db_error)?;
            Ok(Value::Null)
        }
        _ => Err(CatalogError::InvalidMessage),
    }
}
fn list_tasks(db: &Connection, p: &Value) -> Result<Value, CatalogError> {
    let mut clauses = vec!["archived = ?"];
    let mut values = vec![SqlValue::Integer(i64::from(p["archived"] == true))];
    if let Some(providers) = p.get("providers") {
        let providers = providers.as_array().ok_or(CatalogError::InvalidMessage)?;
        if providers.len() > 2
            || providers
                .iter()
                .any(|provider| !matches!(provider.as_str(), Some("codex" | "claude")))
        {
            return Err(CatalogError::InvalidMessage);
        }
        // 引擎过滤先于 LIMIT 和游标，避免未启用引擎挤占综合搜索的候选页。
        clauses.push(match providers.len() {
            0 => "0",
            1 => "provider IN (?)",
            _ => "provider IN (?,?)",
        });
        values.extend(
            providers
                .iter()
                .map(|provider| SqlValue::Text(provider.as_str().unwrap_or_default().to_owned())),
        );
    }
    if let Some(project) = p.get("projectId") {
        clauses.push("project_id IS ?");
        values.push(
            project
                .as_str()
                .map_or(SqlValue::Null, |s| SqlValue::Text(s.to_owned())),
        );
    }
    if p["completed"] == true {
        clauses.push("status IN ('idle','notLoaded') AND project_id IS NOT NULL");
    }
    if p["pinned"] == true {
        clauses.push("pinned = 1");
    }
    if let Some(search) = p["searchTerm"].as_str() {
        clauses.push("instr(lower(title),lower(?)) > 0");
        values.push(SqlValue::Text(search.to_owned()));
    }
    if let Some(cursor) = p["cursor"].as_str() {
        let cursor: (f64, String) =
            serde_json::from_str(cursor).map_err(|_| CatalogError::InvalidMessage)?;
        clauses.push("(updated_at,id) < (?,?)");
        values.extend([SqlValue::Real(cursor.0), SqlValue::Text(cursor.1)]);
    }
    let limit = p["limit"].as_u64().unwrap_or(50).clamp(1, 100) as usize;
    values.push(SqlValue::Integer((limit + 1) as i64));
    let mut statement = db
        .prepare_cached(&format!(
            "SELECT * FROM managed_tasks WHERE {} ORDER BY updated_at DESC,id DESC LIMIT ?",
            clauses.join(" AND ")
        ))
        .map_err(db_error)?;
    let mut data = statement
        .query_map(rusqlite::params_from_iter(values), task)
        .map_err(db_error)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(db_error)?;
    let more = data.len() > limit;
    data.truncate(limit);
    let cursor = if more {
        data.last()
            .map(|t| json!([t["updatedAt"], t["id"]]).to_string())
    } else {
        None
    };
    Ok(json!({"data":data,"nextCursor":cursor}))
}
