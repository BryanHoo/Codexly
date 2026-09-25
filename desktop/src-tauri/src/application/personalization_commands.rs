use super::{error::AppError, state::AppState};
use crate::{
    domain::personalization::{GlobalInstructions, MemorySettings, MemorySettingsUpdate},
    infrastructure::{codex, personalization},
};
use tauri::State;

#[tauri::command]
pub async fn get_global_instructions(
    state: State<'_, AppState>,
) -> Result<GlobalInstructions, AppError> {
    personalization::read_instructions(&state.codex_home().await?)
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn save_global_instructions(
    content: String,
    expected_content: String,
    state: State<'_, AppState>,
) -> Result<GlobalInstructions, AppError> {
    personalization::save_instructions(&state.codex_home().await?, &content, &expected_content)
        .await
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::AlreadyExists {
                AppError::GlobalInstructionsChanged
            } else {
                AppError::FilesystemRequestFailed
            }
        })
}

#[tauri::command]
pub async fn get_memory_settings(state: State<'_, AppState>) -> Result<MemorySettings, AppError> {
    let connection = state.codex_connection().await?;
    codex::personalization::read_memory_settings(&connection)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn update_memory_settings(
    update: MemorySettingsUpdate,
    state: State<'_, AppState>,
) -> Result<MemorySettings, AppError> {
    let connection = state.codex_connection().await?;
    codex::personalization::update_memory_settings(&connection, update)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn reset_memories(state: State<'_, AppState>) -> Result<(), AppError> {
    let connection = state.codex_connection().await?;
    codex::personalization::reset_memories(&connection)
        .await
        .map_err(AppError::from)
}
