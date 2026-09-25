use super::{error::AppError, state::AppState};
use crate::{
    domain::search::{SearchOccurrencesPage, TaskSearchInput, TaskSearchPage},
    infrastructure::codex,
};
use tauri::State;

#[tauri::command(rename_all = "camelCase")]
pub async fn search_tasks(
    input: TaskSearchInput,
    request_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<TaskSearchPage, AppError> {
    state
        .run_cancellable(request_id.as_deref(), async {
            let connection = state.codex_connection().await?;
            codex::search_tasks(&connection, input)
                .await
                .map_err(AppError::from)
        })
        .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn search_task_occurrences(
    task_id: String,
    query: String,
    cursor: Option<String>,
    request_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<SearchOccurrencesPage, AppError> {
    state
        .run_cancellable(request_id.as_deref(), async {
            let connection = state.codex_connection().await?;
            codex::search_task_occurrences(&connection, &task_id, &query, cursor.as_deref())
                .await
                .map_err(AppError::from)
        })
        .await
}
