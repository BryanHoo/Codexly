use crate::infrastructure::local_catalog::{
    LocalCatalog,
    sidebar::{map_project, map_task},
};
use serde_json::json;
use tauri::{AppHandle, Manager, State};

use super::{error::AppError, state::AppState, task_workspace};
use crate::domain::sidebar::{
    AgentTaskMutationResponse, AgentTaskPage, ListTasksInput, ProjectMutationResponse, ProjectPage,
    RemoveProjectResponse,
};

#[tauri::command]
pub async fn list_projects(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ProjectPage, AppError> {
    let response = local_catalog(&app)?.project_page().await?;
    state.remember_project_page(&response).await;
    Ok(response)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn add_project(
    app: AppHandle,
    root_paths: Vec<String>,
    state: State<'_, AppState>,
) -> Result<ProjectMutationResponse, AppError> {
    let response = ProjectMutationResponse {
        project: local_catalog(&app)?.add_project(root_paths).await?,
    };
    state.remember_project(&response.project).await;
    Ok(response)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn rename_project(
    app: AppHandle,
    project_id: String,
    name: String,
    state: State<'_, AppState>,
) -> Result<ProjectMutationResponse, AppError> {
    let response = ProjectMutationResponse {
        project: map_project(
            &local_catalog(&app)?
                .call("project.rename", json!({"id":project_id,"name":name}))
                .await?,
        )?,
    };
    state.remember_project(&response.project).await;
    Ok(response)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn remove_project(
    app: AppHandle,
    project_id: String,
    state: State<'_, AppState>,
) -> Result<RemoveProjectResponse, AppError> {
    local_catalog(&app)?
        .call("project.remove", json!({"id":project_id}))
        .await?;
    let response = RemoveProjectResponse {
        project_id: project_id.clone(),
        status: "removed",
    };
    // 项目删除已成功，必须先使终端失效并回收；后续 settings 失败不能留下运行中的 PTY。
    state.terminals.invalidate_project(&project_id);
    let terminals = state.terminals.clone();
    let terminal_project = project_id.clone();
    tauri::async_runtime::spawn_blocking(move || terminals.close_project(&terminal_project))
        .await
        .map_err(|_| crate::domain::project_terminal::TerminalError::CleanupFailed)??;
    super::terminal_project::remove_preferences(&app, &project_id).await?;
    state.forget_project_activity(&project_id).await;
    Ok(response)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn reorder_projects(
    app: AppHandle,
    project_ids: Vec<String>,
    state: State<'_, AppState>,
) -> Result<ProjectPage, AppError> {
    let catalog = local_catalog(&app)?;
    catalog
        .call("project.reorder", json!({"ids":project_ids}))
        .await?;
    let response = catalog.project_page().await?;
    state.remember_project_page(&response).await;
    Ok(response)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn list_tasks(
    app: AppHandle,
    input: ListTasksInput,
    request_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<AgentTaskPage, AppError> {
    state
        .run_cancellable(request_id.as_deref(), async {
            let project_id = input.project_id.clone();
            let response = local_catalog(&app)?.task_page(input).await?;
            state
                .remember_task_metadata(
                    &project_id,
                    response
                        .data
                        .iter()
                        .map(|task| (task.id.as_str(), task.title.as_str())),
                )
                .await;
            Ok(response)
        })
        .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn start_task(
    app: AppHandle,
    project_id: String,
    idempotency_key: String,
    engine: Option<String>,
    workspace_path: Option<String>,
    state: State<'_, AppState>,
) -> super::task_creation::CreationResult {
    let creation_project = project_id.clone();
    state
        .task_creations
        .run(&project_id, &idempotency_key, async move {
            let state = app.state::<AppState>();
            let response = task_workspace::start_task_for_engine(
                &app,
                creation_project.clone(),
                engine.as_deref().unwrap_or("codex"),
                workspace_path.as_deref().map(std::path::Path::new),
            )
            .await?;
            state
                .remember_task_metadata(
                    &creation_project,
                    [(response.task.id.as_str(), response.task.title.as_str())],
                )
                .await;
            state
                .publish_catalog_task_change(&app, &creation_project, &response.task.id, None)
                .await;
            Ok(response)
        })
        .await
}

pub use super::pending_resolution::resolve_pending_request;

#[tauri::command(rename_all = "camelCase")]
pub async fn rename_task(
    app: AppHandle,
    project_id: String,
    task_id: String,
    title: String,
    state: State<'_, AppState>,
) -> Result<AgentTaskMutationResponse, AppError> {
    let catalog = local_catalog(&app)?;
    catalog.owned_task(&project_id, &task_id).await?;
    let response = AgentTaskMutationResponse {
        task: map_task(
            &catalog
                .call("task.patch", json!({"id":task_id,"title":title}))
                .await?,
        )?,
    };
    state
        .remember_task_metadata(
            &project_id,
            [(response.task.id.as_str(), response.task.title.as_str())],
        )
        .await;
    state
        .publish_catalog_task_change(&app, &project_id, &response.task.id, None)
        .await;
    Ok(response)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn pin_task(
    app: AppHandle,
    project_id: String,
    task_id: String,
    pinned: bool,
    state: State<'_, AppState>,
) -> Result<AgentTaskMutationResponse, AppError> {
    let catalog = local_catalog(&app)?;
    catalog.owned_task(&project_id, &task_id).await?;
    let response = AgentTaskMutationResponse {
        task: map_task(
            &catalog
                .call("task.patch", json!({"id":task_id,"pinned":pinned}))
                .await?,
        )?,
    };
    state
        .remember_task_metadata(
            &project_id,
            [(response.task.id.as_str(), response.task.title.as_str())],
        )
        .await;
    state
        .publish_catalog_task_change(&app, &project_id, &response.task.id, None)
        .await;
    Ok(response)
}

fn app_data_dir(app: &AppHandle) -> Result<std::path::PathBuf, AppError> {
    crate::infrastructure::app_data::directory(app).map_err(|_| AppError::FilesystemRequestFailed)
}

pub(super) fn local_catalog(app: &AppHandle) -> Result<LocalCatalog, AppError> {
    Ok(LocalCatalog::at(&app_data_dir(app)?)?)
}
