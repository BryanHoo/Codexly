use super::{error::AppError, workspace_commands::project_root};
use crate::infrastructure::workspace;
use serde::Deserialize;
use serde_json::Value;
use tauri::AppHandle;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DiscardMutationInput {
    expected_snapshot: String,
    paths: Vec<String>,
    repository: Option<String>,
}

#[tauri::command(rename_all = "camelCase")]
pub async fn discard_project_changes(
    app: AppHandle,
    project_id: String,
    root_path: String,
    input: DiscardMutationInput,
) -> Result<Value, AppError> {
    let (root, _) = project_root(&app, &project_id, &root_path).await?;
    let status = workspace::discard_changes(
        &root,
        input.repository.as_deref(),
        &input.paths,
        &input.expected_snapshot,
    )
    .await
    .map_err(AppError::from)?;
    serde_json::to_value(status).map_err(|_| AppError::FilesystemRequestFailed)
}
