use super::{error::AppError, state::AppState, workspace_commands::project_root};
use crate::infrastructure::workspace;
use serde::Deserialize;
use serde_json::Value;
use tauri::{AppHandle, State};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FileCreationInput {
    parent_path: Option<String>,
    name: String,
    #[serde(rename = "type")]
    kind: String,
}

#[tauri::command(rename_all = "camelCase")]
pub async fn create_project_file(
    app: AppHandle,
    project_id: String,
    root_path: String,
    input: FileCreationInput,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let (root, _) = project_root(&app, &project_id, &root_path).await?;
    let response = workspace::create_project_file(
        &root,
        input.parent_path.as_deref(),
        &input.name,
        &input.kind,
    )
    .await
    .map_err(|error| match error {
        workspace::WorkspaceError::Io(ref io) if io.kind() == std::io::ErrorKind::AlreadyExists => {
            AppError::ProjectFileConflict
        }
        error => AppError::Workspace(error),
    })?;
    // 只失效受影响项目的文件搜索索引；目录快照随响应一次返回。
    state.project_file_search().invalidate(&root);
    serde_json::to_value(response).map_err(|_| AppError::FilesystemRequestFailed)
}
