use super::*;
use crate::domain::sidebar::{
    AgentTask, AgentTaskPage, ListTasksInput, Project, ProjectPage, ProjectRoot,
};

pub fn map_project(value: &Value) -> Result<Project, CatalogError> {
    Ok(Project {
        id: string(value, "id")?.to_owned(),
        name: string(value, "name")?.to_owned(),
        created_at: string(value, "createdAt")?.to_owned(),
        roots: vec![ProjectRoot {
            id: format!("{}-root", string(value, "id")?),
            path: string(value, "path")?.to_owned(),
        }],
    })
}
pub fn map_task(value: &Value) -> Result<AgentTask, CatalogError> {
    let seconds = value["updatedAt"]
        .as_f64()
        .ok_or(CatalogError::InvalidMessage)?;
    Ok(AgentTask {
        engine: (value["provider"] == "claude").then(|| "claude".to_owned()),
        id: string(value, "id")?.to_owned(),
        project_id: value["projectId"]
            .as_str()
            .unwrap_or("temporary")
            .to_owned(),
        title: match string(value, "title")? {
            "" => value["preview"]
                .as_str()
                .filter(|value| !value.is_empty())
                .unwrap_or("新聊天")
                .to_owned(),
            title => title.to_owned(),
        },
        pinned: value["pinned"] == true,
        updated_at: chrono::DateTime::from_timestamp(seconds as i64, 0)
            .ok_or(CatalogError::InvalidMessage)?
            .to_rfc3339(),
        workspace_path: Some(string(value, "cwd")?.to_owned()),
    })
}
impl LocalCatalog {
    pub async fn project_page(&self) -> Result<ProjectPage, CatalogError> {
        let projects = self.call("project.list", Value::Null).await?;
        Ok(ProjectPage {
            data: projects
                .as_array()
                .ok_or(CatalogError::InvalidMessage)?
                .iter()
                .map(map_project)
                .collect::<Result<_, _>>()?,
            next_cursor: None,
        })
    }
    pub async fn task_page(&self, input: ListTasksInput) -> Result<AgentTaskPage, CatalogError> {
        let project = if input.project_id == "temporary" {
            None
        } else {
            Some(input.project_id)
        };
        let page=self.call("task.list",json!({"projectId":project,"archived":input.archived,"cursor":input.cursor,"limit":input.limit,"pinned":input.pinned,"searchTerm":input.search_term})).await?;
        Ok(AgentTaskPage {
            data: page["data"]
                .as_array()
                .ok_or(CatalogError::InvalidMessage)?
                .iter()
                .map(map_task)
                .collect::<Result<_, _>>()?,
            next_cursor: page["nextCursor"].as_str().map(str::to_owned),
        })
    }
    pub async fn owned_task(&self, project_id: &str, task_id: &str) -> Result<Value, CatalogError> {
        let task = self.call("task.read", json!({"id":task_id})).await?;
        if task.is_null() || task["projectId"].as_str().unwrap_or("temporary") != project_id {
            return Err(CatalogError::InvalidMessage);
        }
        Ok(task)
    }
    pub async fn add_project(&self, paths: Vec<String>) -> Result<Project, CatalogError> {
        if paths.len() != 1 {
            return Err(CatalogError::InvalidMessage);
        }
        let path = tokio::fs::canonicalize(&paths[0])
            .await
            .map_err(|_| CatalogError::InvalidMessage)?;
        if !tokio::fs::metadata(&path)
            .await
            .map_err(|_| CatalogError::InvalidMessage)?
            .is_dir()
        {
            return Err(CatalogError::InvalidMessage);
        }
        let path = path.to_string_lossy().into_owned();
        if let Some(project) = self
            .project_page()
            .await?
            .data
            .into_iter()
            .find(|p| p.roots[0].path == path)
        {
            return Ok(project);
        }
        let name = Path::new(&path)
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or(&path);
        map_project(&self.call("project.put",json!({"id":format!("project-{}",uuid::Uuid::new_v4()),"path":path,"name":name,"createdAt":chrono::Utc::now().to_rfc3339()})).await?)
    }
}
