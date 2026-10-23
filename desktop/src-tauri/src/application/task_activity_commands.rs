use tauri::{AppHandle, Emitter, State};

use super::{
    desktop_pet_commands::render_desktop_pet_task_activities, error::AppError, state::AppState,
};

#[tauri::command]
pub async fn get_task_activities(
    state: State<'_, AppState>,
) -> Result<Vec<serde_json::Value>, AppError> {
    Ok(state.task_activity_read_snapshot().await)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn acknowledge_task_activity(
    app: AppHandle,
    project_id: String,
    task_id: String,
    async_question_ids: Option<Vec<String>>,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    // 普通聚焦只确认终态；显式回答或关闭问题时才解除对应的待输入事实。
    let changed = if let Some(question_ids) = async_question_ids {
        let mut changed = false;
        for question_id in question_ids {
            changed |= state
                .resolve_async_question_activity(&project_id, &task_id, &question_id)
                .await;
        }
        changed
    } else {
        state.acknowledge_task_activity(&project_id, &task_id).await
    };
    if changed {
        if let Err(error) = app.emit("task-activity://changed", ()) {
            crate::infrastructure::diagnostics::record_error("task_activity_notify_failed", error);
        }
        render_desktop_pet_task_activities(&app, &state.task_activity_snapshot().await).await?;
    }
    Ok(())
}
