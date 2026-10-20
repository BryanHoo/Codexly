use super::{error::AppError, state::AppState};
use crate::{
    domain::search::{SearchOccurrencesPage, TaskSearchInput, TaskSearchPage},
    infrastructure::{codex, local_catalog::LocalCatalog},
};
use serde_json::{Value, json};
use tauri::{AppHandle, State};

#[path = "catalog_search.rs"]
mod catalog;

#[tauri::command(rename_all = "camelCase")]
pub async fn search_tasks(
    app: AppHandle,
    input: TaskSearchInput,
    request_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<TaskSearchPage, AppError> {
    state
        .run_cancellable(request_id.as_deref(), async {
            let catalog = LocalCatalog::at(
                &crate::infrastructure::app_data::directory(&app)
                    .map_err(|_| AppError::FilesystemRequestFailed)?,
            )?;
            catalog::search(&catalog, input, |task, query| {
                occurrences(&app, &state, task, query, None, 1)
            })
            .await
        })
        .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn search_task_occurrences(
    app: AppHandle,
    task_id: String,
    query: String,
    cursor: Option<String>,
    request_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<SearchOccurrencesPage, AppError> {
    state
        .run_cancellable(request_id.as_deref(), async {
            let catalog = LocalCatalog::at(
                &crate::infrastructure::app_data::directory(&app)
                    .map_err(|_| AppError::FilesystemRequestFailed)?,
            )?;
            let task = catalog.call("task.read", json!({"id":task_id})).await?;
            occurrences(&app, &state, task, query, cursor, 30).await
        })
        .await
}

async fn occurrences(
    app: &AppHandle,
    state: &AppState,
    task: Value,
    query: String,
    cursor: Option<String>,
    limit: usize,
) -> Result<SearchOccurrencesPage, AppError> {
    let id = task["id"].as_str().ok_or(AppError::CodexRequestFailed)?;
    match task["provider"].as_str() {
        Some("claude") => {
            // 检索走共享摘要服务，不建立 Claude SDK 会话，更不会初始化 Codex。
            let mut input = json!({"query":query});
            if let Some(cursor) = cursor {
                input["cursor"] = json!(cursor);
            }
            let result = state
                .claude
                .request(
                    app,
                    "search.occurrences",
                    Some(super::claude_tasks::scope(&task)),
                    json!({"taskId":id,"input":input,"limit":limit}),
                )
                .await?;
            serde_json::from_value(result).map_err(|error| AppError::Claude(error.to_string()))
        }
        Some("codex") => {
            let connection = state.codex_connection().await?;
            if limit == 30 {
                codex::search_task_occurrences(&connection, id, &query, cursor.as_deref())
                    .await
                    .map_err(Into::into)
            } else {
                codex::search_task_occurrences_with_limit(
                    &connection,
                    id,
                    &query,
                    cursor.as_deref(),
                    limit,
                )
                .await
                .map_err(Into::into)
            }
        }
        _ => Err(AppError::CodexRequestFailed),
    }
}
