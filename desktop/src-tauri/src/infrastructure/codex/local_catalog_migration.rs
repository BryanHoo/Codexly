use super::{AppServerConnection, ConnectionError};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    time::Duration,
};

async fn pages(
    connection: &AppServerConnection,
    method: &str,
    mut params: Value,
) -> Result<Vec<Value>, ConnectionError> {
    let mut result = Vec::new();
    let mut seen = HashSet::new();
    params["limit"] = json!(100);
    loop {
        let page: Value = connection
            .request_raw(method, &params, Duration::from_secs(30))
            .await?;
        result.extend(
            page["data"]
                .as_array()
                .ok_or(ConnectionError::InvalidMessage)?
                .iter()
                .cloned(),
        );
        let Some(cursor) = page["nextCursor"].as_str() else {
            return Ok(result);
        };
        if !seen.insert(cursor.to_owned()) || seen.len() > 10000 {
            return Err(ConnectionError::InvalidMessage);
        }
        params["cursor"] = json!(cursor);
    }
}
impl AppServerConnection {
    pub(super) async fn initialize_catalog(&self) -> Result<(), ConnectionError> {
        let Some(catalog) = &self.catalog else {
            return Ok(());
        };
        if catalog.call("migration.done", Value::Null).await? != true {
            let mut projects = Vec::new();
            let mut by_path = HashMap::<String, Value>::new();
            let mut by_source = HashMap::<String, Vec<Value>>::new();
            for project in pages(self, "project/list", json!({})).await? {
                let source = project["id"]
                    .as_str()
                    .ok_or(ConnectionError::InvalidMessage)?;
                let mut candidates = Vec::new();
                for (index, root) in project["roots"]
                    .as_array()
                    .ok_or(ConnectionError::InvalidMessage)?
                    .iter()
                    .enumerate()
                {
                    let original = root["path"]
                        .as_str()
                        .ok_or(ConnectionError::InvalidMessage)?;
                    // 不存在的历史目录仍须保留，以便用户迁回磁盘或删除目录记录。
                    let path = tokio::fs::canonicalize(original).await.map_or_else(
                        |_| original.to_owned(),
                        |p| p.to_string_lossy().into_owned(),
                    );
                    let mapped = by_path
                        .entry(path.clone())
                        .or_insert_with(|| {
                            let suffix = Sha256::digest(path.as_bytes())
                                .iter()
                                .map(|byte| format!("{byte:02x}"))
                                .collect::<String>();
                            let id = if index == 0 {
                                source.to_owned()
                            } else {
                                format!("{source}-{}", &suffix[..16])
                            };
                            let name = if index == 0 {
                                project["name"].clone()
                            } else {
                                json!(
                                    std::path::Path::new(&path)
                                        .file_name()
                                        .and_then(|s| s.to_str())
                                        .unwrap_or(&path)
                                )
                            };
                            let created = super::sidebar::unix_seconds_to_rfc3339(
                                project["createdAt"].as_i64().unwrap_or_default(),
                            );
                            let value =
                                json!({"id":id,"name":name,"path":path,"createdAt":created,"sourceId":source});
                            projects.push(value.clone());
                            value
                        })
                        .clone();
                    candidates.push(mapped);
                }
                by_source.insert(source.to_owned(), candidates);
            }
            let mut tasks = Vec::new();
            for archived in [false, true] {
                for native in pages(
                    self,
                    "thread/list",
                    json!({"archived":archived,"modelProviders":[]}),
                )
                .await?
                {
                    let cwd = native["cwd"]
                        .as_str()
                        .ok_or(ConnectionError::InvalidMessage)?;
                    let path = tokio::fs::canonicalize(cwd)
                        .await
                        .map_or_else(|_| cwd.to_owned(), |p| p.to_string_lossy().into_owned());
                    let candidates = native["projectId"]
                        .as_str()
                        .and_then(|id| by_source.get(id));
                    let owner = candidates.and_then(|roots| {
                        roots
                            .iter()
                            .filter(|r| {
                                r["path"].as_str().is_some_and(|p| {
                                    path == p || std::path::Path::new(&path).starts_with(p)
                                })
                            })
                            .max_by_key(|r| r["path"].as_str().map_or(0, str::len))
                            .or_else(|| roots.first())
                    });
                    let title = native["name"]
                        .as_str()
                        .filter(|s| !s.trim().is_empty())
                        .unwrap_or_else(|| {
                            native["preview"]
                                .as_str()
                                .unwrap_or_default()
                                .lines()
                                .next()
                                .unwrap_or_default()
                        });
                    tasks.push(json!({"id":native["id"],"projectId":owner.map(|p|p["id"].clone()),"title":title,"cwd":cwd,"provider":"codex","sessionId":native["id"],"updatedAt":native["updatedAt"],"archived":archived,"pinned":native["section"]["id"]=="01984de2-8f74-7c91-a3b2-5c5e937cf318","status":"notLoaded","sourceId":native["projectId"]}));
                }
            }
            // 复制而非移动旧偏好；只有文件与数据库都成功后才记录完成标记。
            super::local_catalog_settings::copy_migrated_settings(
                catalog.app_data()?,
                &projects,
                &tasks,
            )
            .await?;
            catalog
                .call(
                    "migration.import",
                    json!({"projects":projects,"tasks":tasks}),
                )
                .await?;
        }
        for task in catalog
            .call("task.bindings", Value::Null)
            .await?
            .as_array()
            .ok_or(ConnectionError::InvalidMessage)?
        {
            self.remember_catalog_task(task)?;
        }
        Ok(())
    }
}
