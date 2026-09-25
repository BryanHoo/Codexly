use serde_json::Value;
use tauri::{AppHandle, State};

use super::{error::AppError, state::AppState};
use crate::{domain::conversation::AgentPromptInput, infrastructure::codex};

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadFeedbackInput {
    classification: String,
    include_logs: bool,
    reason: String,
}

async fn validate_task(
    state: &State<'_, AppState>,
    project_id: String,
    task_id: &str,
) -> Result<std::sync::Arc<codex::AppServerConnection>, AppError> {
    let connection = state.codex_connection().await?;
    codex::read_task(&connection, project_id, task_id.to_owned())
        .await
        .map_err(AppError::from)?;
    Ok(connection)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn update_task_goal(
    project_id: String,
    task_id: String,
    status: String,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let connection = validate_task(&state, project_id, &task_id).await?;
    let response = codex::update_goal(&connection, &task_id, &status)
        .await
        .map_err(AppError::from)?;
    serde_json::to_value(response).map_err(|_| AppError::CodexRequestFailed)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn clear_task_goal(
    project_id: String,
    task_id: String,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let connection = validate_task(&state, project_id, &task_id).await?;
    let response = codex::clear_goal(&connection, &task_id)
        .await
        .map_err(AppError::from)?;
    serde_json::to_value(response).map_err(|_| AppError::CodexRequestFailed)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn upload_feedback(
    project_id: String,
    task_id: String,
    input: UploadFeedbackInput,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let connection = validate_task(&state, project_id, &task_id).await?;
    let response = codex::upload_feedback(
        &connection,
        &task_id,
        &input.classification,
        &input.reason,
        input.include_logs,
    )
    .await
    .map_err(AppError::from)?;
    serde_json::to_value(response).map_err(|_| AppError::CodexRequestFailed)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn list_background_terminals(
    project_id: String,
    task_id: String,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let connection = validate_task(&state, project_id, &task_id).await?;
    let response = codex::list_background_terminals(&connection, &task_id)
        .await
        .map_err(AppError::from)?;
    serde_json::to_value(response).map_err(|_| AppError::CodexRequestFailed)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn terminate_background_terminal(
    project_id: String,
    task_id: String,
    terminal_id: String,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let connection = validate_task(&state, project_id, &task_id).await?;
    let response = codex::terminate_background_terminal(&connection, &task_id, &terminal_id)
        .await
        .map_err(AppError::from)?;
    serde_json::to_value(response).map_err(|_| AppError::CodexRequestFailed)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn list_queued_submissions(
    project_id: String,
    task_id: String,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let connection = validate_task(&state, project_id, &task_id).await?;
    let response = codex::read_queued_submissions(&connection, &task_id)
        .await
        .map_err(AppError::from)?;
    serde_json::to_value(response).map_err(|_| AppError::CodexRequestFailed)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn add_queued_submission(
    app: AppHandle,
    project_id: String,
    task_id: String,
    input: AgentPromptInput,
    client_user_message_id: String,
    idempotency_key: String,
) -> Result<Value, Value> {
    super::queue_add::add(
        app,
        super::queue_add::QueueAddRequest {
            project_id,
            task_id,
            input,
            client_user_message_id,
            idempotency_key,
        },
    )
    .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn delete_queued_submission(
    project_id: String,
    task_id: String,
    queued_submission_id: String,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let connection = validate_task(&state, project_id, &task_id).await?;
    let response = codex::delete_queued_submission(&connection, &task_id, &queued_submission_id)
        .await
        .map_err(AppError::from)?;
    serde_json::to_value(response).map_err(|_| AppError::CodexRequestFailed)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn move_queued_submission(
    project_id: String,
    task_id: String,
    queued_submission_id: String,
    offset: i8,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let connection = validate_task(&state, project_id, &task_id).await?;
    let moved = codex::move_queued_submission(&connection, &task_id, &queued_submission_id, offset)
        .await
        .map_err(AppError::from)?;
    Ok(serde_json::json!({ "moved": moved }))
}
