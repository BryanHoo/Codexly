use super::{error::AppError, state::AppState};
use crate::{
    domain::sidebar::{AgentTaskPage, ListCompletedTasksInput},
    infrastructure::local_catalog::{LocalCatalog, sidebar::map_task},
};
use serde_json::json;
use tauri::{AppHandle, Manager, State};

#[tauri::command(rename_all = "camelCase")]
pub async fn list_completed_tasks(
    app: AppHandle,
    input: ListCompletedTasksInput,
    request_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<AgentTaskPage, AppError> {
    state
        .run_cancellable(request_id.as_deref(), async {
            let catalog = LocalCatalog::at(
                &app.path()
                    .app_data_dir()
                    .map_err(|_| AppError::FilesystemRequestFailed)?,
            )?;
            let mut query =
                json!({"completed":true,"limit":input.limit.unwrap_or(10),"cursor":input.cursor});
            if let Some(project) = input.project_id {
                query["projectId"] = json!(project);
            }
            let page = catalog.call("task.list", query).await?;
            Ok(AgentTaskPage {
                data: page["data"]
                    .as_array()
                    .ok_or(AppError::FilesystemRequestFailed)?
                    .iter()
                    .map(map_task)
                    .collect::<Result<_, _>>()?,
                next_cursor: page["nextCursor"].as_str().map(str::to_owned),
            })
        })
        .await
}
