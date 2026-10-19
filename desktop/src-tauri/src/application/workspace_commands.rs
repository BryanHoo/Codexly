use std::{path::PathBuf, time::Duration};

use serde::Deserialize;
use serde_json::{Value, json};
use tauri::{AppHandle, Manager, State};
use tokio::time::timeout;

use super::{error::AppError, state::AppState, task_workspace};
use crate::infrastructure::{codex, workspace};

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
pub struct CommitMutationInput {
    action: Option<String>,
    expected_snapshot: String,
    message: Option<String>,
    paths: Vec<String>,
    repository: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PushMutationInput {
    expected_snapshot: String,
    repository: Option<String>,
    action: Option<String>,
    remote: Option<String>,
    url: Option<String>,
    branch_name: Option<String>,
    expected_head: Option<String>,
    expected_branch: Option<String>,
}

#[tauri::command(rename_all = "camelCase")]
pub async fn push_project_commits(
    app: AppHandle,
    project_id: String,
    root_path: String,
    input: PushMutationInput,
    _state: State<'_, AppState>,
) -> Result<Value, AppError> {
    // 与其他 Git 操作共用项目/worktree 归属校验，前端不能指定任意仓库目录。
    let (root, _) = project_root(&app, &project_id, &root_path).await?;
    let response = if let Some(action) = input.action.as_deref() {
        workspace::operate_project_remote(
            &root,
            input.repository.as_deref(),
            &input.expected_snapshot,
            workspace::RemoteAction {
                action,
                remote: input.remote.as_deref(),
                url: input.url.as_deref(),
                branch_name: input.branch_name.as_deref(),
                expected_head: input.expected_head.as_deref(),
                expected_branch: input.expected_branch.as_deref(),
            },
        )
        .await
    } else {
        workspace::push_commits(&root, input.repository.as_deref(), &input.expected_snapshot).await
    }
    .map_err(AppError::from)?;
    serde_json::to_value(response).map_err(|_| AppError::FilesystemRequestFailed)
}

#[path = "workspace_project_root.rs"]
mod workspace_project_root;

pub(super) async fn project_root(
    app: &AppHandle,
    project_id: &str,
    root_path: &str,
) -> Result<(PathBuf, String), AppError> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    let catalog = crate::infrastructure::local_catalog::LocalCatalog::at(&directory)?;
    workspace_project_root::resolve(&catalog, project_id, root_path).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn list_project_files(
    app: AppHandle,
    project_id: String,
    root_path: String,
    directory_path: Option<String>,
    request_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    state
        .run_cancellable(request_id.as_deref(), async {
            let (root, _) = project_root(&app, &project_id, &root_path).await?;
            let response = workspace::list_project_files(&root, directory_path.as_deref())
                .await
                .map_err(|_| AppError::FilesystemRequestFailed)?;
            serde_json::to_value(response).map_err(|_| AppError::FilesystemRequestFailed)
        })
        .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn search_project_files(
    app: AppHandle,
    project_id: String,
    root_path: String,
    query: String,
    session_id: String,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let (root, root_id) = project_root(&app, &project_id, &root_path).await?;
    let response = state
        .project_file_search()
        .search(&root, &root_id, &query, &session_id)
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    serde_json::to_value(response).map_err(|_| AppError::FilesystemRequestFailed)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn stop_project_file_search(
    app: AppHandle,
    project_id: String,
    root_path: String,
    session_id: String,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    state.project_file_search().cancel(&session_id);
    project_root(&app, &project_id, &root_path).await?;
    Ok(json!({}))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn rename_project_file(
    app: AppHandle,
    project_id: String,
    root_path: String,
    input: FileMutationInput,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let (root, _) = project_root(&app, &project_id, &root_path).await?;
    let name = input.name.ok_or(AppError::FilesystemRequestFailed)?;
    let response = workspace::rename_project_file(&root, &input.path, &name)
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    state.project_file_search().invalidate(&root);
    serde_json::to_value(response).map_err(|_| AppError::FilesystemRequestFailed)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn delete_project_file(
    app: AppHandle,
    project_id: String,
    root_path: String,
    input: FileMutationInput,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let (root, _) = project_root(&app, &project_id, &root_path).await?;
    let response = workspace::delete_project_file(&root, &input.path)
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    state.project_file_search().invalidate(&root);
    serde_json::to_value(response).map_err(|_| AppError::FilesystemRequestFailed)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn read_project_source_file(
    app: AppHandle,
    project_id: String,
    root_path: Option<String>,
    task_id: Option<String>,
    path: String,
    cursor: Option<usize>,
    _state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let root = task_workspace::resolve_preview_root(
        Some(
            &app.path()
                .app_data_dir()
                .map_err(|_| AppError::FilesystemRequestFailed)?,
        ),
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
    app: AppHandle,
    project_id: String,
    input: GitStatusInput,
    request_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    state
        .run_cancellable(request_id.as_deref(), async {
            let (root, _) = project_root(&app, &project_id, &input.root_path).await?;
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
    app: AppHandle,
    project_id: String,
    input: GitHistoryInput,
    request_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    state
        .run_cancellable(request_id.as_deref(), async {
            let (root, _) = project_root(&app, &project_id, &input.root_path).await?;
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
    app: AppHandle,
    project_id: String,
    input: GitCommitInput,
    request_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    state
        .run_cancellable(request_id.as_deref(), async {
            let (root, _) = project_root(&app, &project_id, &input.root_path).await?;
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
    app: AppHandle,
    project_id: String,
    input: GitCommitInput,
    request_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    state
        .run_cancellable(request_id.as_deref(), async {
            let (root, _) = project_root(&app, &project_id, &input.root_path).await?;
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
    app: AppHandle,
    project_id: String,
    root_path: String,
    input: BranchMutationInput,
    _state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let (root, _) = project_root(&app, &project_id, &root_path).await?;
    let response = workspace::switch_branch(&root, None, &input.branch, &input.expected_snapshot)
        .await
        .map_err(AppError::from)?;
    serde_json::to_value(response).map_err(|_| AppError::FilesystemRequestFailed)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn create_project_branch(
    app: AppHandle,
    project_id: String,
    root_path: String,
    input: BranchMutationInput,
    _state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let (root, _) = project_root(&app, &project_id, &root_path).await?;
    let response = workspace::create_branch(&root, None, &input.branch, &input.expected_snapshot)
        .await
        .map_err(AppError::from)?;
    serde_json::to_value(response).map_err(|_| AppError::FilesystemRequestFailed)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn list_project_worktrees(
    app: AppHandle,
    project_id: String,
    root_path: String,
    _state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let (root, _) = project_root(&app, &project_id, &root_path).await?;
    let response = workspace::list_worktrees(&root, None)
        .await
        .map_err(AppError::from)?;
    serde_json::to_value(response).map_err(|_| AppError::FilesystemRequestFailed)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn generate_commit_message(
    app: AppHandle,
    project_id: String,
    root_path: String,
    input: CommitMutationInput,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let (root, _) = project_root(&app, &project_id, &root_path).await?;
    let context = workspace::prepare_commit_message(
        &root,
        input.repository.as_deref(),
        &input.paths,
        &input.expected_snapshot,
    )
    .await
    .map_err(AppError::from)?;
    let global_settings = super::generation_settings::read(&app).await?;
    let settings = codex::resolve_commit_message_settings(&global_settings);
    if global_settings["defaultAgent"] == "claude" {
        // 只读取本地项目目录并复用 Claude 宿主的无工具请求，不启动 Codex 推理。
        let prompt = format!(
            "{}\n\n以下是选中的 Git 变更：\n{}",
            settings.prompt, context.changes
        );
        let message = state
            .claude
            .request(
                &app,
                "commit.generate",
                None,
                json!({"prompt": prompt, "model": settings.model}),
            )
            .await?;
        let text = message
            .as_str()
            .filter(|text| !text.trim().is_empty() && text.len() <= 10000)
            .ok_or(AppError::FilesystemRequestFailed)?;
        return Ok(json!({"message": text, "snapshot": context.snapshot}));
    }
    let connection = state.codex_connection().await?;
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
    app: AppHandle,
    project_id: String,
    root_path: String,
    input: CommitMutationInput,
    _state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let (root, _) = project_root(&app, &project_id, &root_path).await?;
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
