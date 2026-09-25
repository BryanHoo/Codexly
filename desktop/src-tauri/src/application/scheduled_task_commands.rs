use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::domain::scheduled_task::{
    ScheduledTask, ScheduledTaskInput, ScheduledTaskPage, ScheduledTaskSchedule,
};
use crate::infrastructure::scheduled_tasks::resolve_schedule_runs;

use super::{error::AppError, scheduled_task_runtime::ScheduledTaskRuntime};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledTaskMutationResponse {
    pub task: ScheduledTask,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteScheduledTaskResponse {
    pub status: &'static str,
    pub task_id: String,
}

#[derive(Serialize)]
pub struct ScheduledTaskPreview {
    dates: Vec<i64>,
}

#[tauri::command(rename_all = "camelCase")]
pub async fn preview_scheduled_task(
    schedule: ScheduledTaskSchedule,
) -> Result<ScheduledTaskPreview, AppError> {
    // 预览不获取调度器状态锁、不访问磁盘或 Provider；CPU 计算移出异步执行器。
    tauri::async_runtime::spawn_blocking(move || {
        resolve_schedule_runs(&schedule, chrono::Utc::now().timestamp_millis(), 5)
            .map(|dates| ScheduledTaskPreview { dates })
            .map_err(|_| AppError::ScheduledTaskInvalid)
    })
    .await
    .map_err(|_| AppError::ScheduledTaskInvalid)?
}

#[tauri::command]
pub async fn list_scheduled_tasks(
    app: AppHandle,
    runtime: State<'_, ScheduledTaskRuntime>,
) -> Result<ScheduledTaskPage, AppError> {
    Ok(ScheduledTaskPage {
        data: runtime.list(&app_data_dir(&app)?).await?,
    })
}

#[tauri::command(rename_all = "camelCase")]
pub async fn create_scheduled_task(
    app: AppHandle,
    input: ScheduledTaskInput,
    runtime: State<'_, ScheduledTaskRuntime>,
) -> Result<ScheduledTaskMutationResponse, AppError> {
    Ok(ScheduledTaskMutationResponse {
        task: runtime.create(&app_data_dir(&app)?, input).await?,
    })
}

#[tauri::command(rename_all = "camelCase")]
pub async fn update_scheduled_task(
    app: AppHandle,
    task_id: String,
    input: ScheduledTaskInput,
    runtime: State<'_, ScheduledTaskRuntime>,
) -> Result<ScheduledTaskMutationResponse, AppError> {
    Ok(ScheduledTaskMutationResponse {
        task: runtime
            .update(&app_data_dir(&app)?, &task_id, input)
            .await?,
    })
}

#[tauri::command(rename_all = "camelCase")]
pub async fn delete_scheduled_task(
    app: AppHandle,
    task_id: String,
    runtime: State<'_, ScheduledTaskRuntime>,
) -> Result<DeleteScheduledTaskResponse, AppError> {
    runtime.delete(&app_data_dir(&app)?, &task_id).await?;
    Ok(DeleteScheduledTaskResponse {
        status: "deleted",
        task_id,
    })
}

#[tauri::command(rename_all = "camelCase")]
pub async fn set_scheduled_task_enabled(
    app: AppHandle,
    task_id: String,
    enabled: bool,
    runtime: State<'_, ScheduledTaskRuntime>,
) -> Result<ScheduledTaskMutationResponse, AppError> {
    Ok(ScheduledTaskMutationResponse {
        task: runtime
            .set_enabled(&app_data_dir(&app)?, &task_id, enabled)
            .await?,
    })
}

#[tauri::command(rename_all = "camelCase")]
pub async fn run_scheduled_task_now(
    app: AppHandle,
    task_id: String,
    runtime: State<'_, ScheduledTaskRuntime>,
) -> Result<ScheduledTaskMutationResponse, AppError> {
    Ok(ScheduledTaskMutationResponse {
        task: runtime
            .run_now(app.clone(), &app_data_dir(&app)?, &task_id)
            .await?,
    })
}

fn app_data_dir(app: &AppHandle) -> Result<std::path::PathBuf, AppError> {
    app.path()
        .app_data_dir()
        .map_err(|_| AppError::FilesystemRequestFailed)
}
