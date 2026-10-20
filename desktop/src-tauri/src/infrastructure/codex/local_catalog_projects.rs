use super::{AppServerConnection, ConnectionError};
use crate::infrastructure::local_catalog::LocalCatalog;
use serde_json::{Value, json};

fn native(project: Value, position: usize) -> Value {
    let created = project["createdAt"]
        .as_str()
        .and_then(|v| chrono::DateTime::parse_from_rfc3339(v).ok())
        .map_or(0, |v| v.timestamp());
    json!({"id":project["id"],"name":project["name"],"roots":[{"path":project["path"]}],"createdAt":created,"position":position})
}
pub async fn request(
    catalog: &LocalCatalog,
    method: &str,
    params: Value,
) -> Result<Value, ConnectionError> {
    match method {
        "project/list" => {
            let values = catalog.call("project.list", Value::Null).await?;
            let projects = values
                .as_array()
                .ok_or(ConnectionError::InvalidMessage)?
                .iter()
                .cloned()
                .enumerate()
                .map(|(i, p)| native(p, i))
                .collect::<Vec<_>>();
            Ok(json!({"data":projects,"nextCursor":null}))
        }
        "project/read" => {
            let project = catalog
                .call("project.read", json!({"id":params["projectId"]}))
                .await?;
            if project.is_null() {
                return Err(ConnectionError::InvalidMessage);
            }
            Ok(json!({"project":native(project,0)}))
        }
        "project/create" => {
            let roots = params["roots"]
                .as_array()
                .filter(|r| r.len() == 1)
                .ok_or(ConnectionError::InvalidMessage)?;
            let path = roots[0]["path"]
                .as_str()
                .ok_or(ConnectionError::InvalidMessage)?;
            let path = tokio::fs::canonicalize(path)
                .await
                .map_err(|_| ConnectionError::InvalidMessage)?;
            if !tokio::fs::metadata(&path)
                .await
                .map_err(|_| ConnectionError::InvalidMessage)?
                .is_dir()
            {
                return Err(ConnectionError::InvalidMessage);
            }
            let path = crate::infrastructure::local_catalog::project_path(&path);
            let projects = catalog.call("project.list", Value::Null).await?;
            if let Some(project) = projects
                .as_array()
                .and_then(|ps| ps.iter().find(|p| p["path"] == path))
            {
                return Ok(json!({"project":native(project.clone(),0)}));
            }
            let project=catalog.call("project.put",json!({"id":format!("project-{}",uuid::Uuid::new_v4()),"name":params["name"],"path":path,"createdAt":chrono::Utc::now().to_rfc3339()})).await?;
            Ok(json!({"project":native(project,0)}))
        }
        "project/update" => Ok(
            json!({"project":native(catalog.call("project.rename",json!({"id":params["projectId"],"name":params["name"]})).await?,0)}),
        ),
        "project/delete" => {
            catalog
                .call("project.remove", json!({"id":params["projectId"]}))
                .await?;
            Ok(json!({}))
        }
        "project/move" => {
            let values = catalog.call("project.list", Value::Null).await?;
            let mut ids = values
                .as_array()
                .ok_or(ConnectionError::InvalidMessage)?
                .iter()
                .map(|p| p["id"].clone())
                .collect::<Vec<_>>();
            if !ids.contains(&params["projectId"]) {
                return Err(ConnectionError::InvalidMessage);
            }
            ids.retain(|id| id != &params["projectId"]);
            let index = ids
                .iter()
                .position(|id| id == &params["beforeProjectId"])
                .unwrap_or(ids.len());
            ids.insert(index, params["projectId"].clone());
            catalog.call("project.reorder", json!({"ids":ids})).await?;
            Ok(json!({}))
        }
        _ => Err(ConnectionError::InvalidMessage),
    }
}
impl AppServerConnection {
    pub(super) async fn catalog_project_request(
        &self,
        catalog: &LocalCatalog,
        method: &str,
        params: Value,
    ) -> Result<Value, ConnectionError> {
        request(catalog, method, params).await
    }
}
