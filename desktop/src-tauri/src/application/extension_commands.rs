use serde_json::Value;
use tauri::State;

use super::{error::AppError, state::AppState};
use crate::infrastructure::codex;

async fn project_roots(state: &State<'_, AppState>) -> Result<Vec<String>, AppError> {
    let connection = state.codex_connection().await?;
    let projects = codex::list_projects(&connection).await?;
    Ok(projects
        .data
        .into_iter()
        .flat_map(|project| project.roots.into_iter().map(|root| root.path))
        .collect())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn list_official_plugins(
    force_refetch: bool,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let roots = project_roots(&state).await?;
    let connection = state.codex_connection().await?;
    codex::list_official_plugins(&connection, roots, force_refetch)
        .await
        .map_err(AppError::from)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn get_official_plugin(
    marketplace_name: String,
    marketplace_path: Option<String>,
    plugin_name: String,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let connection = state.codex_connection().await?;
    codex::get_official_plugin(
        &connection,
        &marketplace_name,
        marketplace_path.as_deref(),
        &plugin_name,
    )
    .await
    .map_err(AppError::from)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn install_official_plugin(
    marketplace_name: String,
    marketplace_path: Option<String>,
    plugin_name: String,
    install_attempt_id: String,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let connection = state.codex_connection().await?;
    codex::install_official_plugin(
        &connection,
        &marketplace_name,
        marketplace_path.as_deref(),
        &plugin_name,
        Some(&install_attempt_id),
    )
    .await
    .map_err(AppError::from)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn uninstall_official_plugin(
    plugin_id: String,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let connection = state.codex_connection().await?;
    codex::uninstall_official_plugin(&connection, &plugin_id)
        .await
        .map_err(AppError::from)
}
