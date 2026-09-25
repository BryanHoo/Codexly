use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRoot {
    pub id: String,
    pub path: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub created_at: String,
    pub id: String,
    pub name: String,
    pub roots: Vec<ProjectRoot>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectPage {
    pub data: Vec<Project>,
    pub next_cursor: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMutationResponse {
    pub project: Project,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveProjectResponse {
    pub project_id: String,
    pub status: &'static str,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct FilesystemRoot {
    pub name: String,
    pub path: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ProjectDirectoryEntry {
    pub name: String,
    pub path: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDirectoryListing {
    pub entries: Vec<ProjectDirectoryEntry>,
    pub parent_path: Option<String>,
    pub path: String,
    pub roots: Vec<FilesystemRoot>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct HostFileEntry {
    pub name: String,
    pub path: String,
    #[serde(rename = "type")]
    pub kind: &'static str,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostFileListing {
    pub entries: Vec<HostFileEntry>,
    pub parent_path: Option<String>,
    pub path: String,
    pub roots: Vec<FilesystemRoot>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTask {
    pub id: String,
    pub pinned: bool,
    pub project_id: String,
    pub title: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTaskPage {
    pub data: Vec<AgentTask>,
    pub next_cursor: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListTasksInput {
    pub archived: Option<bool>,
    pub cursor: Option<String>,
    pub limit: Option<u32>,
    pub pinned: Option<bool>,
    pub project_id: String,
    pub search_term: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListCompletedTasksInput {
    pub cursor: Option<String>,
    pub limit: Option<u32>,
    pub project_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct AgentTaskMutationResponse {
    pub task: AgentTask,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTaskStatusResponse {
    pub status: &'static str,
    pub task_id: String,
}
