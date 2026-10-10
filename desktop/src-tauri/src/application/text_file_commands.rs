use super::{error::AppError, state::AppState, workspace_commands::project_root};
use crate::infrastructure::workspace;
use serde_json::Value;
use tauri::State;

#[tauri::command(rename_all = "camelCase")]
pub async fn read_project_text_file(
    project_id: String,
    root_path: String,
    path: String,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let (_, root, _) = project_root(&state, &project_id, &root_path).await?;
    // 有界文件读取与哈希在阻塞线程执行，避免阻塞 Tauri 的异步命令调度。
    let response = tokio::task::spawn_blocking(move || workspace::read_text_file(&root, &path))
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)??;
    serde_json::to_value(response).map_err(|_| AppError::FilesystemRequestFailed)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn save_project_text_file(
    project_id: String,
    root_path: String,
    input: workspace::SaveTextInput,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let (_, root, _) = project_root(&state, &project_id, &root_path).await?;
    let response = tokio::task::spawn_blocking(move || workspace::save_text_file(&root, &input))
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)??;
    serde_json::to_value(response).map_err(|_| AppError::FilesystemRequestFailed)
}
