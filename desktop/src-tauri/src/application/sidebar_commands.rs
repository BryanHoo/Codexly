use serde_json::{Value, json};
use tauri::{AppHandle, Manager, State};

use super::{
    error::AppError, scheduled_task_runner::start_turn_for_task,
    sidebar_task_settings::effective_task_settings, state::AppState, task_workspace,
};
use crate::{
    domain::conversation::{
        AgentPromptInput, AgentTaskSettings, AgentTaskSnapshotResponse, AgentTurnActionResponse,
        AgentTurnOptions,
    },
    domain::sidebar::{
        AgentTaskMutationResponse, AgentTaskPage, AgentTaskStatusResponse, ListTasksInput,
        ProjectMutationResponse, ProjectPage, RemoveProjectResponse,
    },
    infrastructure::{
        codex,
        task_settings::{delete_project_task_settings, delete_task_settings, write_task_settings},
    },
};

#[tauri::command]
pub async fn list_projects(state: State<'_, AppState>) -> Result<ProjectPage, AppError> {
    let connection = state.codex_connection().await?;
    let response = codex::list_projects(&connection)
        .await
        .map_err(AppError::from)?;
    state.remember_project_page(&response).await;
    Ok(response)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn add_project(
    root_paths: Vec<String>,
    state: State<'_, AppState>,
) -> Result<ProjectMutationResponse, AppError> {
    let connection = state.codex_connection().await?;
    let response = codex::add_project(&connection, root_paths)
        .await
        .map_err(AppError::from)?;
    state.remember_project(&response.project).await;
    Ok(response)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn rename_project(
    project_id: String,
    name: String,
    state: State<'_, AppState>,
) -> Result<ProjectMutationResponse, AppError> {
    let connection = state.codex_connection().await?;
    let response = codex::rename_project(&connection, project_id, name)
        .await
        .map_err(AppError::from)?;
    state.remember_project(&response.project).await;
    Ok(response)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn remove_project(
    app: AppHandle,
    project_id: String,
    state: State<'_, AppState>,
) -> Result<RemoveProjectResponse, AppError> {
    let connection = state.codex_connection().await?;
    let response = codex::remove_project(&connection, project_id.clone())
        .await
        .map_err(AppError::from)?;
    // 项目删除已成功，必须先使终端失效并回收；后续 settings 失败不能留下运行中的 PTY。
    state.terminals.invalidate_project(&project_id);
    let terminals = state.terminals.clone();
    let terminal_project = project_id.clone();
    tauri::async_runtime::spawn_blocking(move || terminals.close_project(&terminal_project))
        .await
        .map_err(|_| crate::domain::project_terminal::TerminalError::CleanupFailed)??;
    super::terminal_project::remove_preferences(&app, &project_id).await?;
    delete_project_task_settings(&app_data_dir(&app)?, &project_id)
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    state.forget_project_activity(&project_id).await;
    Ok(response)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn reorder_projects(
    project_ids: Vec<String>,
    state: State<'_, AppState>,
) -> Result<ProjectPage, AppError> {
    let connection = state.codex_connection().await?;
    let response = codex::reorder_projects(&connection, project_ids)
        .await
        .map_err(AppError::from)?;
    state.remember_project_page(&response).await;
    Ok(response)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn list_tasks(
    input: ListTasksInput,
    request_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<AgentTaskPage, AppError> {
    state
        .run_cancellable(request_id.as_deref(), async {
            let connection = state.codex_connection().await?;
            let project_id = input.project_id.clone();
            let response = codex::list_tasks(&connection, input)
                .await
                .map_err(AppError::from)?;
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
pub async fn read_task(
    app: AppHandle,
    project_id: String,
    task_id: String,
    cursor: Option<String>,
    request_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<AgentTaskSnapshotResponse, AppError> {
    state
        .run_cancellable(request_id.as_deref(), async {
            let connection = state.codex_connection().await?;
            state.remember_tasks(&project_id, [task_id.as_str()]).await;
            let baseline = state.task_snapshot_baseline(&project_id).await;
            let mut response = codex::read_task_snapshot(
                &connection,
                project_id.clone(),
                task_id.clone(),
                cursor.as_deref(),
            )
            .await
            .map_err(AppError::from)?;
            response.snapshot.settings =
                effective_task_settings(&app, &project_id, &task_id).await?;
            task_workspace::allow_attachment_assets(&app, &project_id, &task_id).await?;
            state
                .complete_task_snapshot_at(&mut response, Some(baseline))
                .await;
            state.remember_task_snapshot(&response.snapshot).await;
            Ok(response)
        })
        .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn start_task(
    app: AppHandle,
    project_id: String,
    idempotency_key: String,
    state: State<'_, AppState>,
) -> super::task_creation::CreationResult {
    let creation_project = project_id.clone();
    state
        .task_creations
        .run(&project_id, &idempotency_key, async move {
            let state = app.state::<AppState>();
            let connection = state.codex_connection().await?;
            let response =
                task_workspace::start_task(&app, &connection, creation_project.clone()).await?;
            state
                .remember_task_metadata(
                    &creation_project,
                    [(response.task.id.as_str(), response.task.title.as_str())],
                )
                .await;
            Ok(response)
        })
        .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn start_turn(
    app: AppHandle,
    project_id: String,
    task_id: String,
    input: AgentPromptInput,
    options: AgentTurnOptions,
    idempotency_key: String,
    state: State<'_, AppState>,
) -> super::turn_start::TurnStartResult {
    let identity = super::turn_start::fingerprint(&project_id, &task_id, &input, &options)?;
    state
        .turn_starts
        .run(&idempotency_key, identity, async move {
            let state = app.state::<AppState>();
            start_turn_for_task(&app, &project_id, &task_id, input, options, &state).await
        })
        .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn get_task_settings(
    app: AppHandle,
    project_id: String,
    task_id: String,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let connection = state.codex_connection().await?;
    codex::read_task(&connection, project_id.clone(), task_id.clone())
        .await
        .map_err(AppError::from)?;
    Ok(json!({
        "settings": effective_task_settings(&app, &project_id, &task_id).await?,
    }))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn update_task_settings(
    app: AppHandle,
    project_id: String,
    task_id: String,
    settings: AgentTaskSettings,
    turn_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    if !settings.is_valid() {
        return Err(AppError::CodexRequestFailed);
    }
    let connection = state.codex_connection().await?;
    codex::read_task(&connection, project_id.clone(), task_id.clone())
        .await
        .map_err(AppError::from)?;
    let reviewer_update = if let Some(turn_id) = turn_id
        && effective_task_settings(&app, &project_id, &task_id)
            .await?
            .approvals_reviewer
            != settings.approvals_reviewer
    {
        // 服务端拒绝时不落盘；回合已结束则只保存未来设置，明确返回未应用状态。
        Some(
            codex::update_live_reviewer(
                &connection,
                &task_id,
                &turn_id,
                &settings.approvals_reviewer,
            )
            .await
            .map_err(AppError::from)?,
        )
    } else {
        None
    };
    write_task_settings(&app_data_dir(&app)?, &project_id, &task_id, &settings)
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    Ok(json!({"settings": settings, "reviewerUpdate": reviewer_update}))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn interrupt_turn(
    task_id: String,
    turn_id: String,
    state: State<'_, AppState>,
) -> Result<AgentTurnActionResponse, AppError> {
    let connection = state.codex_connection().await?;
    codex::interrupt_turn(&connection, task_id, turn_id)
        .await
        .map_err(AppError::from)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn resolve_pending_request(
    app: AppHandle,
    request: super::pending_resolution::PendingResolutionReference,
    resolution: Value,
    idempotency_key: String,
) -> Result<Value, Value> {
    super::pending_resolution::resolve(app, request, resolution, idempotency_key).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn compact_task(
    project_id: String,
    task_id: String,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let connection = state.codex_connection().await?;
    let response = codex::compact_task(&connection, &project_id, &task_id)
        .await
        .map_err(AppError::from)?;
    serde_json::to_value(response).map_err(|_| AppError::CodexRequestFailed)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn rename_task(
    project_id: String,
    task_id: String,
    title: String,
    state: State<'_, AppState>,
) -> Result<AgentTaskMutationResponse, AppError> {
    let connection = state.codex_connection().await?;
    let response = codex::rename_task(&connection, project_id.clone(), task_id, title)
        .await
        .map_err(AppError::from)?;
    state
        .remember_task_metadata(
            &project_id,
            [(response.task.id.as_str(), response.task.title.as_str())],
        )
        .await;
    Ok(response)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn pin_task(
    project_id: String,
    task_id: String,
    pinned: bool,
    state: State<'_, AppState>,
) -> Result<AgentTaskMutationResponse, AppError> {
    let connection = state.codex_connection().await?;
    let response = codex::pin_task(&connection, project_id.clone(), task_id, pinned)
        .await
        .map_err(AppError::from)?;
    state
        .remember_task_metadata(
            &project_id,
            [(response.task.id.as_str(), response.task.title.as_str())],
        )
        .await;
    Ok(response)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn archive_task(
    project_id: String,
    task_id: String,
    state: State<'_, AppState>,
) -> Result<AgentTaskStatusResponse, AppError> {
    let connection = state.codex_connection().await?;
    codex::archive_task(&connection, project_id, task_id)
        .await
        .map_err(AppError::from)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn unarchive_task(
    project_id: String,
    task_id: String,
    state: State<'_, AppState>,
) -> Result<AgentTaskMutationResponse, AppError> {
    let connection = state.codex_connection().await?;
    let response = codex::unarchive_task(&connection, project_id.clone(), task_id)
        .await
        .map_err(AppError::from)?;
    state
        .remember_task_metadata(
            &project_id,
            [(response.task.id.as_str(), response.task.title.as_str())],
        )
        .await;
    Ok(response)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn delete_task(
    app: AppHandle,
    project_id: String,
    task_id: String,
    state: State<'_, AppState>,
) -> Result<AgentTaskStatusResponse, AppError> {
    let connection = state.codex_connection().await?;
    let deleted = codex::delete_task(&connection, project_id.clone(), task_id.clone())
        .await
        .map_err(AppError::from)?;
    task_workspace::remove_deleted_workspace(
        &app,
        &project_id,
        &task_id,
        deleted.working_directory.as_deref(),
    )
    .await?;
    delete_task_settings(&app_data_dir(&app)?, &project_id, &task_id)
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    Ok(deleted.response)
}

fn app_data_dir(app: &AppHandle) -> Result<std::path::PathBuf, AppError> {
    app.path()
        .app_data_dir()
        .map_err(|_| AppError::FilesystemRequestFailed)
}
