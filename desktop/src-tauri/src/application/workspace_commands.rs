use std::{path::PathBuf, sync::Arc, time::Duration};

use serde::Deserialize;
use serde_json::{Value, json};
use tauri::{AppHandle, Manager, State};
use tokio::time::timeout;

use super::{error::AppError, state::AppState, task_workspace};
use crate::infrastructure::{codex, local_settings, workspace};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileMutationInput {
    name: Option<String>,
    path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusInput {
    cursor: Option<String>,
    diff_path: Option<String>,
    diff_staged: Option<bool>,
    repository: Option<String>,
    root_path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHistoryInput {
    cursor: Option<String>,
    repository: Option<String>,
    root_path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitInput {
    cursor: Option<String>,
    path: Option<String>,
    repository: Option<String>,
    root_path: String,
    sha: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchMutationInput {
    branch: String,
    expected_snapshot: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeSwitchInput {
    path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitMutationInput {
    action: Option<String>,
    expected_snapshot: String,
    message: Option<String>,
    paths: Vec<String>,
    repository: Option<String>,
}

pub(super) async fn project_root(
    state: &State<'_, AppState>,
    project_id: &str,
    root_path: &str,
) -> Result<(Arc<codex::AppServerConnection>, PathBuf, String), AppError> {
    let connection = state.codex_connection().await?;
    let project = codex::read_project(&connection, project_id)
        .await
        .map_err(AppError::from)?;
    let root = project
        .roots
        .into_iter()
        .find(|root| root.path == root_path)
        .ok_or(AppError::FilesystemRequestFailed)?;
    let canonical = workspace::canonical_root(&root.path)
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    Ok((connection, canonical, root.id))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn list_project_files(
    project_id: String,
    root_path: String,
    directory_path: Option<String>,
    request_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    state
        .run_cancellable(request_id.as_deref(), async {
            let (_, root, _) = project_root(&state, &project_id, &root_path).await?;
            let response = workspace::list_project_files(&root, directory_path.as_deref())
                .await
                .map_err(|_| AppError::FilesystemRequestFailed)?;
            serde_json::to_value(response).map_err(|_| AppError::FilesystemRequestFailed)
        })
        .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn search_project_files(
    project_id: String,
    root_path: String,
    query: String,
    session_id: String,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let (_, root, root_id) = project_root(&state, &project_id, &root_path).await?;
    let response = state
        .project_file_search()
        .search(&root, &root_id, &query, &session_id)
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    serde_json::to_value(response).map_err(|_| AppError::FilesystemRequestFailed)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn stop_project_file_search(
    project_id: String,
    root_path: String,
    session_id: String,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    state.project_file_search().cancel(&session_id);
    project_root(&state, &project_id, &root_path).await?;
    Ok(json!({}))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn rename_project_file(
    project_id: String,
    root_path: String,
    input: FileMutationInput,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let (_, root, _) = project_root(&state, &project_id, &root_path).await?;
    let name = input.name.ok_or(AppError::FilesystemRequestFailed)?;
    let response = workspace::rename_project_file(&root, &input.path, &name)
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    state.project_file_search().invalidate(&root);
    serde_json::to_value(response).map_err(|_| AppError::FilesystemRequestFailed)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn delete_project_file(
    project_id: String,
    root_path: String,
    input: FileMutationInput,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let (_, root, _) = project_root(&state, &project_id, &root_path).await?;
    let response = workspace::delete_project_file(&root, &input.path)
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    state.project_file_search().invalidate(&root);
    serde_json::to_value(response).map_err(|_| AppError::FilesystemRequestFailed)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn read_project_source_file(
    project_id: String,
    root_path: Option<String>,
    task_id: Option<String>,
    path: String,
    cursor: Option<usize>,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let root = task_workspace::resolve_preview_root(
        &state,
        &project_id,
        task_id.as_deref(),
        root_path.as_deref(),
        &path,
    )
    .await?;
    let relative = task_workspace::relative_preview_path(&root, &path)?;
    let response = workspace::read_source_file(&root, &relative, cursor)
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    serde_json::to_value(response).map_err(|_| AppError::FilesystemRequestFailed)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn get_project_git_status(
    project_id: String,
    input: GitStatusInput,
    request_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    state
        .run_cancellable(request_id.as_deref(), async {
            let (_, root, _) = project_root(&state, &project_id, &input.root_path).await?;
            let response = if let Some(path) = input.diff_path.as_deref() {
                workspace::get_git_file_status(
                    &root,
                    input.repository.as_deref(),
                    path,
                    input.diff_staged.unwrap_or(false),
                )
                .await
            } else {
                workspace::get_git_status_page(
                    &root,
                    input.repository.as_deref(),
                    input.cursor.as_deref(),
                )
                .await
            }
            .map_err(AppError::from)?;
            serde_json::to_value(response).map_err(|_| AppError::FilesystemRequestFailed)
        })
        .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn get_project_git_history(
    project_id: String,
    input: GitHistoryInput,
    request_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    state
        .run_cancellable(request_id.as_deref(), async {
            let (_, root, _) = project_root(&state, &project_id, &input.root_path).await?;
            let response = workspace::get_git_history(
                &root,
                input.repository.as_deref(),
                input.cursor.as_deref(),
            )
            .await
            .map_err(AppError::from)?;
            serde_json::to_value(response).map_err(|_| AppError::FilesystemRequestFailed)
        })
        .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn get_project_git_commit_files(
    project_id: String,
    input: GitCommitInput,
    request_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    state
        .run_cancellable(request_id.as_deref(), async {
            let (_, root, _) = project_root(&state, &project_id, &input.root_path).await?;
            let response = workspace::get_commit_files(
                &root,
                input.repository.as_deref(),
                &input.sha,
                input.cursor.as_deref(),
            )
            .await
            .map_err(AppError::from)?;
            serde_json::to_value(response).map_err(|_| AppError::FilesystemRequestFailed)
        })
        .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn get_project_git_commit_file_diff(
    project_id: String,
    input: GitCommitInput,
    request_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    state
        .run_cancellable(request_id.as_deref(), async {
            let (_, root, _) = project_root(&state, &project_id, &input.root_path).await?;
            let path = input.path.ok_or(AppError::FilesystemRequestFailed)?;
            let response =
                workspace::get_commit_diff(&root, input.repository.as_deref(), &input.sha, &path)
                    .await
                    .map_err(AppError::from)?;
            serde_json::to_value(response).map_err(|_| AppError::FilesystemRequestFailed)
        })
        .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn switch_project_branch(
    project_id: String,
    root_path: String,
    input: BranchMutationInput,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let (_, root, _) = project_root(&state, &project_id, &root_path).await?;
    let response = workspace::switch_branch(&root, None, &input.branch, &input.expected_snapshot)
        .await
        .map_err(AppError::from)?;
    serde_json::to_value(response).map_err(|_| AppError::FilesystemRequestFailed)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn create_project_branch(
    project_id: String,
    root_path: String,
    input: BranchMutationInput,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let (_, root, _) = project_root(&state, &project_id, &root_path).await?;
    let response = workspace::create_branch(&root, None, &input.branch, &input.expected_snapshot)
        .await
        .map_err(AppError::from)?;
    serde_json::to_value(response).map_err(|_| AppError::FilesystemRequestFailed)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn list_project_worktrees(
    project_id: String,
    root_path: String,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let (_, root, _) = project_root(&state, &project_id, &root_path).await?;
    let response = workspace::list_worktrees(&root, None)
        .await
        .map_err(AppError::from)?;
    serde_json::to_value(response).map_err(|_| AppError::FilesystemRequestFailed)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn create_project_worktree(
    project_id: String,
    root_path: String,
    input: BranchMutationInput,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let (connection, root, _) = project_root(&state, &project_id, &root_path).await?;
    let worktree = workspace::create_worktree(&root, None, &input.branch, &input.expected_snapshot)
        .await
        .map_err(AppError::from)?;
    let project = project_for_worktree(&connection, &worktree.path).await?;
    Ok(json!({"project": project, "worktree": worktree}))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn switch_project_worktree(
    project_id: String,
    root_path: String,
    input: WorktreeSwitchInput,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let (connection, root, _) = project_root(&state, &project_id, &root_path).await?;
    let worktree = workspace::switch_worktree(&root, None, &input.path)
        .await
        .map_err(AppError::from)?;
    let project = project_for_worktree(&connection, &worktree.path).await?;
    Ok(json!({"project": project, "worktree": worktree}))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn generate_commit_message(
    app: AppHandle,
    project_id: String,
    root_path: String,
    input: CommitMutationInput,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let (connection, root, _) = project_root(&state, &project_id, &root_path).await?;
    let context = workspace::prepare_commit_message(
        &root,
        input.repository.as_deref(),
        &input.paths,
        &input.expected_snapshot,
    )
    .await
    .map_err(AppError::from)?;
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    let global_settings = local_settings::read_global_settings(&app_data)
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    let settings = codex::resolve_commit_message_settings(&global_settings);
    let thread_id = codex::start_commit_message_thread(&connection, &root, &settings.model)
        .await
        .map_err(AppError::from)?;
    let completed = state.register_model_turn(&thread_id).await;
    if let Err(error) = codex::start_commit_message_turn(
        &connection,
        &thread_id,
        &settings.model,
        &settings.prompt,
        &context.changes,
    )
    .await
    {
        state.cancel_model_turn(&thread_id).await;
        return Err(AppError::from(error));
    }
    let output = match timeout(Duration::from_secs(120), completed).await {
        Ok(Ok(Some(output))) => output,
        _ => {
            state.cancel_model_turn(&thread_id).await;
            return Err(AppError::CodexRequestFailed);
        }
    };
    let message =
        codex::parse_commit_message_output(&output).map_err(|_| AppError::CodexRequestFailed)?;
    Ok(json!({"message": message, "snapshot": context.snapshot}))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn commit_project_changes(
    project_id: String,
    root_path: String,
    input: CommitMutationInput,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let (_, root, _) = project_root(&state, &project_id, &root_path).await?;
    let response = workspace::commit_changes(
        &root,
        input.repository.as_deref(),
        &input.paths,
        input
            .message
            .as_deref()
            .ok_or(AppError::FilesystemRequestFailed)?,
        input
            .action
            .as_deref()
            .ok_or(AppError::FilesystemRequestFailed)?,
        &input.expected_snapshot,
    )
    .await
    .map_err(AppError::from)?;
    serde_json::to_value(response).map_err(|_| AppError::FilesystemRequestFailed)
}

async fn project_for_worktree(
    connection: &codex::AppServerConnection,
    path: &str,
) -> Result<crate::domain::sidebar::Project, AppError> {
    let projects = codex::list_projects(connection)
        .await
        .map_err(AppError::from)?;
    if let Some(project) = projects
        .data
        .into_iter()
        .find(|project| project.roots.iter().any(|root| root.path == path))
    {
        return Ok(project);
    }
    codex::add_project(connection, vec![path.to_owned()])
        .await
        .map(|response| response.project)
        .map_err(AppError::from)
}
