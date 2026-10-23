use crate::infrastructure::local_catalog::{
    LocalCatalog,
    sidebar::{map_project, map_task},
};
use serde_json::{Value, json};
use tauri::{AppHandle, Emitter, Manager, State};

use super::{
    error::AppError, scheduled_task_runner::start_turn_for_task,
    sidebar_task_settings::effective_task_settings, state::AppState, task_workspace,
};
use crate::{
    domain::conversation::{AgentPromptInput, AgentTurnActionResponse, AgentTurnOptions},
    domain::sidebar::{
        AgentTaskMutationResponse, AgentTaskPage, AgentTaskStatusResponse, ListTasksInput,
        ProjectMutationResponse, ProjectPage, RemoveProjectResponse,
    },
    infrastructure::{
        codex,
        task_settings::{delete_project_task_settings, delete_task_settings},
    },
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
    delete_project_task_settings(&app_data_dir(&app)?, &project_id)
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)?;
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
pub async fn read_task(
    app: AppHandle,
    project_id: String,
    task_id: String,
    cursor: Option<String>,
    summary: Option<bool>,
    request_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    state
        .run_cancellable(request_id.as_deref(), async {
            let task = super::claude_tasks::task(&app, &project_id, &task_id).await?;
            if task["provider"] == "claude" {
                return super::claude_tasks::read(
                    &app,
                    &project_id,
                    &task_id,
                    &task,
                    cursor,
                    summary,
                )
                .await;
            }
            let connection = state.codex_connection().await?;
            state.remember_tasks(&project_id, [task_id.as_str()]).await;
            let baseline = state.task_snapshot_baseline(&project_id).await;
            let mut response = if summary.unwrap_or(false) {
                codex::read_task_summary_snapshot(
                    &connection,
                    project_id.clone(),
                    task_id.clone(),
                    cursor.as_deref(),
                )
                .await
            } else {
                codex::read_task_snapshot(
                    &connection,
                    project_id.clone(),
                    task_id.clone(),
                    cursor.as_deref(),
                )
                .await
            }
            .map_err(AppError::from)?;
            response.snapshot.settings =
                effective_task_settings(&app, &project_id, &task_id).await?;
            task_workspace::allow_attachment_assets(&app, &project_id, &task_id).await?;
            state
                .complete_task_snapshot_at(&mut response, Some(baseline))
                .await;
            if state.remember_task_snapshot(&response.snapshot).await
                && let Err(error) = app.emit("task-activity://changed", ())
            {
                crate::infrastructure::diagnostics::record_error(
                    "task_activity_notify_failed",
                    error,
                );
            }
            serde_json::to_value(response).map_err(|_| AppError::CodexRequestFailed)
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

pub use super::sidebar_task_settings::{get_task_settings, update_task_settings};

/// 父回合结束后仍可停止后台工作；只通过任务绑定的 Claude 宿主操作原生任务 ID。
#[tauri::command(rename_all = "camelCase")]
pub async fn stop_task_session(
    app: AppHandle,
    project_id: String,
    task_id: String,
    background_task_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let task = super::claude_tasks::task(&app, &project_id, &task_id).await?;
    if task["provider"] != "claude" {
        return Err(AppError::Claude(
            "Session control is unavailable for this engine".into(),
        ));
    }
    state
        .claude
        .request(
            &app,
            "session.stop",
            Some(super::claude_tasks::scope(&task)),
            json!({"taskId":task_id,"backgroundTaskId":background_task_id}),
        )
        .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn interrupt_turn(
    app: AppHandle,
    project_id: String,
    task_id: String,
    turn_id: String,
    state: State<'_, AppState>,
) -> Result<AgentTurnActionResponse, AppError> {
    let task = super::claude_tasks::task(&app, &project_id, &task_id).await?;
    if task["provider"] == "claude" {
        state
            .claude
            .request(
                &app,
                "turn.interrupt",
                Some(super::claude_tasks::scope(&task)),
                json!({"taskId":task_id,"turnId":turn_id}),
            )
            .await?;
        return Ok(AgentTurnActionResponse {
            status: "accepted",
            task_id,
            turn_id,
        });
    }
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

pub use super::task_compact_commands::compact_task;

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

#[tauri::command(rename_all = "camelCase")]
pub async fn archive_task(
    app: AppHandle,
    project_id: String,
    task_id: String,
    state: State<'_, AppState>,
) -> Result<AgentTaskStatusResponse, AppError> {
    let catalog = local_catalog(&app)?;
    let task = catalog.owned_task(&project_id, &task_id).await?;
    if task["provider"] == "claude" {
        // 共享适配器负责拒绝执行中的任务、关闭空闲会话并发布移除事件。
        state.remember_tasks(&project_id, [task_id.as_str()]).await;
        state
            .claude
            .request(
                &app,
                "task.archive",
                Some(super::claude_tasks::scope(&task)),
                json!({"taskId":task_id}),
            )
            .await?;
        return Ok(AgentTaskStatusResponse {
            status: "archived",
            task_id,
        });
    }
    catalog
        .call("task.patch", json!({"id":task_id,"archived":true}))
        .await?;
    state
        .publish_catalog_task_change(&app, &project_id, &task_id, Some("archived"))
        .await;
    Ok(AgentTaskStatusResponse {
        status: "archived",
        task_id,
    })
}

#[tauri::command(rename_all = "camelCase")]
pub async fn unarchive_task(
    app: AppHandle,
    project_id: String,
    task_id: String,
    state: State<'_, AppState>,
) -> Result<AgentTaskMutationResponse, AppError> {
    let catalog = local_catalog(&app)?;
    catalog.owned_task(&project_id, &task_id).await?;
    let response = AgentTaskMutationResponse {
        task: map_task(
            &catalog
                .call("task.patch", json!({"id":task_id,"archived":false}))
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
pub async fn delete_task(
    app: AppHandle,
    project_id: String,
    task_id: String,
    state: State<'_, AppState>,
) -> Result<AgentTaskStatusResponse, AppError> {
    let catalog = local_catalog(&app)?;
    let task = catalog.owned_task(&project_id, &task_id).await?;
    let is_claude = task["provider"] == "claude";
    if is_claude {
        // 必须等待共享适配器确认会话已释放；失败时保留任务及临时工作目录。
        state.remember_tasks(&project_id, [task_id.as_str()]).await;
        state
            .claude
            .request(
                &app,
                "task.delete",
                Some(super::claude_tasks::scope(&task)),
                json!({"taskId":task_id}),
            )
            .await?;
    } else {
        catalog.call("task.remove", json!({"id":task_id})).await?;
    }
    let working_directory = task["cwd"].as_str().map(std::path::PathBuf::from);
    task_workspace::remove_deleted_workspace(
        &app,
        &project_id,
        &task_id,
        working_directory.as_deref(),
    )
    .await?;
    delete_task_settings(&app_data_dir(&app)?, &project_id, &task_id)
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    if !is_claude {
        state
            .publish_catalog_task_change(&app, &project_id, &task_id, Some("deleted"))
            .await;
    }
    Ok(AgentTaskStatusResponse {
        status: "deleted",
        task_id,
    })
}

fn app_data_dir(app: &AppHandle) -> Result<std::path::PathBuf, AppError> {
    crate::infrastructure::app_data::directory(app).map_err(|_| AppError::FilesystemRequestFailed)
}

pub(super) fn local_catalog(app: &AppHandle) -> Result<LocalCatalog, AppError> {
    Ok(LocalCatalog::at(&app_data_dir(app)?)?)
}
