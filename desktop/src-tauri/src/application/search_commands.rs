use super::{error::AppError, state::AppState};
use crate::{
    domain::search::{SearchOccurrencesPage, TaskSearchInput, TaskSearchPage},
    infrastructure::local_catalog::LocalCatalog,
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
    agent_runtime: Option<String>,
    state: State<'_, AppState>,
) -> Result<TaskSearchPage, AppError> {
    require_acp(agent_runtime.as_deref())?;
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
    agent_runtime: Option<String>,
    state: State<'_, AppState>,
) -> Result<SearchOccurrencesPage, AppError> {
    require_acp(agent_runtime.as_deref())?;
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
    // 任务目录决定作用域，前端只选择协议；两种引擎共用同一个 ACP 摘要实现。
    let mut input = json!({"query":query});
    if let Some(cursor) = cursor {
        input["cursor"] = json!(cursor);
    }
    let result = state
        .acp
        .host
        .request(
            app,
            "search.occurrences",
            Some(acp_scope(&task)?),
            json!({"taskId":id,"input":input,"limit":limit}),
        )
        .await?;
    serde_json::from_value(result).map_err(|_| AppError::Acp("Invalid ACP search response".into()))
}

pub(super) fn require_acp(runtime: Option<&str>) -> Result<(), AppError> {
    match runtime {
        None | Some("acp") => Ok(()),
        Some(_) => Err(AppError::Acp("Unknown agent runtime".into())),
    }
}

pub(super) fn acp_scope(task: &Value) -> Result<Value, AppError> {
    let root = task["cwd"]
        .as_str()
        .filter(|root| !root.is_empty())
        .ok_or(AppError::FilesystemRequestFailed)?;
    let project = task["projectId"].as_str().unwrap_or("temporary");
    Ok(
        json!({"id":project,"kind":if task["projectId"].is_null(){"temporary"}else{"project"},"rootPath":root,"runtimeWorkspaceRoots":[root]}),
    )
}
