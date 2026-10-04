use super::{error::AppError, state::AppState};
use crate::infrastructure::codex::history_storage::{self, HistoryCompressionResult};
use tauri::State;

#[tauri::command]
pub async fn compress_history(
    state: State<'_, AppState>,
) -> Result<HistoryCompressionResult, AppError> {
    let connection = state.codex_connection().await?;
    history_storage::compress_history(&connection)
        .await
        .map_err(AppError::from)
}
