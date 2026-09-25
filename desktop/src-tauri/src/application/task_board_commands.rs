use tauri::State;

use super::{error::AppError, state::AppState};
use crate::{
    domain::sidebar::{AgentTaskPage, ListCompletedTasksInput},
    infrastructure::codex,
};

#[tauri::command(rename_all = "camelCase")]
pub async fn list_completed_tasks(
    input: ListCompletedTasksInput,
    request_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<AgentTaskPage, AppError> {
    state
        .run_cancellable(request_id.as_deref(), async {
            let connection = state.codex_connection().await?;
            codex::list_completed_tasks(&connection, input)
                .await
                .map_err(AppError::from)
        })
        .await
}
