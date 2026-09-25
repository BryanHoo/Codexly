use tauri::{AppHandle, State};

use super::{
    desktop_pet_commands::render_desktop_pet_task_activities, error::AppError, state::AppState,
    task_activity::TaskActivitySnapshot,
};

#[tauri::command]
pub async fn get_task_activities(
    state: State<'_, AppState>,
) -> Result<Vec<TaskActivitySnapshot>, AppError> {
    Ok(state.task_activity_snapshot().await)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn acknowledge_task_activity(
    app: AppHandle,
    project_id: String,
    task_id: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    if state.acknowledge_task_activity(&project_id, &task_id).await {
        render_desktop_pet_task_activities(&app, &state.task_activity_snapshot().await).await?;
    }
    Ok(())
}
