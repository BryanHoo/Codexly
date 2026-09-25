use serde_json::{Value, json};
use tauri::{AppHandle, Manager, State};

use super::{error::AppError, state::AppState};
use crate::infrastructure::{codex, local_settings};

fn request_error(error: codex::ConnectionError) -> AppError {
    AppError::from(error)
}

fn provider_error(error: codex::ProviderError) -> AppError {
    match error {
        codex::ProviderError::Connection(error) => AppError::from(error),
        codex::ProviderError::Storage => AppError::FilesystemRequestFailed,
    }
}

#[tauri::command]
pub async fn list_models(app: AppHandle, state: State<'_, AppState>) -> Result<Value, AppError> {
    state.codex_connection().await?;
    let app_data = app_data_dir(&app)?;
    // 主连接固定启动时的 Provider；目录连接按最新磁盘配置独立启动。
    let catalog_process = codex::CodexProcess::start(&app_data)
        .await
        .map_err(|_| AppError::CodexRuntimeStartFailed)?;
    codex::list_provider_models(&catalog_process.connection(), &app_data)
        .await
        .map_err(provider_error)
}

#[tauri::command]
pub async fn get_provider_connection(state: State<'_, AppState>) -> Result<Value, AppError> {
    let connection = state.codex_connection().await?;
    codex::get_provider_connection(&connection, state.provider_login().await)
        .await
        .map_err(request_error)
}

#[tauri::command]
pub async fn start_official_provider_login(state: State<'_, AppState>) -> Result<Value, AppError> {
    let connection = state.codex_connection().await?;
    let response = codex::start_official_provider_login(&connection)
        .await
        .map_err(request_error)?;
    state
        .set_provider_login(response.pointer("/status/pendingLogin").cloned())
        .await;
    Ok(response)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn cancel_provider_login(
    login_id: String,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let connection = state.codex_connection().await?;
    let response = codex::cancel_provider_login(&connection, &login_id)
        .await
        .map_err(request_error)?;
    state.set_provider_login(None).await;
    Ok(response)
}

#[tauri::command]
pub async fn logout_provider(state: State<'_, AppState>) -> Result<Value, AppError> {
    let connection = state.codex_connection().await?;
    let response = codex::logout_provider(&connection)
        .await
        .map_err(request_error)?;
    state.set_provider_login(None).await;
    Ok(response)
}

#[tauri::command]
pub async fn configure_custom_provider(
    app: AppHandle,
    input: Value,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let connection = state.codex_connection().await?;
    let response = codex::configure_custom_provider(&connection, &app_data_dir(&app)?, input)
        .await
        .map_err(provider_error)?;
    state.set_provider_login(None).await;
    Ok(response)
}

#[tauri::command]
pub async fn get_global_settings(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let connection = state.codex_connection().await?;
    let settings = codex::read_global_settings(&connection, &app_data_dir(&app)?)
        .await
        .map_err(AppError::from)?;
    Ok(json!({"settings": settings}))
}

#[tauri::command]
pub async fn update_global_settings(
    app: AppHandle,
    settings: Value,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let connection = state.codex_connection().await?;
    let update = codex::update_global_settings(&connection, &app_data_dir(&app)?, settings)
        .await
        .map_err(AppError::from)?;
    Ok(json!({
        "changedFields": update.changed_fields,
        "settings": update.settings,
    }))
}

async fn validate_project(
    state: &State<'_, AppState>,
    project_id: &str,
) -> Result<
    (
        std::sync::Arc<codex::AppServerConnection>,
        crate::domain::sidebar::Project,
    ),
    AppError,
> {
    let connection = state.codex_connection().await?;
    let project = codex::read_project(&connection, project_id)
        .await
        .map_err(request_error)?;
    Ok((connection, project))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn get_project_defaults(
    app: AppHandle,
    project_id: String,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let (connection, _) = validate_project(&state, &project_id).await?;
    let settings = codex::read_project_defaults(&connection, &app_data_dir(&app)?, &project_id)
        .await
        .map_err(AppError::from)?;
    Ok(json!({"settings": settings}))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn update_project_defaults(
    app: AppHandle,
    project_id: String,
    settings: Value,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    validate_project(&state, &project_id).await?;
    let update =
        local_settings::update_project_defaults(&app_data_dir(&app)?, &project_id, settings)
            .await
            .map_err(|_| AppError::FilesystemRequestFailed)?;
    Ok(json!({
        "changedFields": update.changed_fields,
        "settings": update.settings,
    }))
}

fn app_data_dir(app: &AppHandle) -> Result<std::path::PathBuf, AppError> {
    app.path()
        .app_data_dir()
        .map_err(|_| AppError::FilesystemRequestFailed)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn list_skills(
    project_id: String,
    force_reload: bool,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let (connection, project) = validate_project(&state, &project_id).await?;
    let cwd = project
        .roots
        .first()
        .map(|root| root.path.as_str())
        .ok_or(AppError::CodexRequestFailed)?;
    codex::list_skills(&connection, cwd, force_reload)
        .await
        .map_err(request_error)
}

async fn validate_task(
    connection: &codex::AppServerConnection,
    project_id: &str,
    task_id: &str,
) -> Result<(), AppError> {
    codex::read_task(connection, project_id.to_owned(), task_id.to_owned())
        .await
        .map(|_| ())
        .map_err(request_error)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn list_mcp_servers(
    project_id: String,
    task_id: String,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let connection = state.codex_connection().await?;
    validate_task(&connection, &project_id, &task_id).await?;
    codex::list_mcp_servers(&connection, &task_id)
        .await
        .map_err(request_error)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn retry_mcp_servers(
    project_id: String,
    task_id: String,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let connection = state.codex_connection().await?;
    validate_task(&connection, &project_id, &task_id).await?;
    codex::reload_mcp_servers(&connection, &task_id)
        .await
        .map_err(request_error)
}
