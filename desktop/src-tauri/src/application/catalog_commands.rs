use serde_json::{Value, json};
use tauri::{AppHandle, Emitter, State};

use super::{error::AppError, state::AppState};
use crate::infrastructure::{codex, local_settings};

fn request_error(error: codex::ConnectionError) -> AppError {
    AppError::from(error)
}

fn provider_error(error: codex::ProviderError) -> AppError {
    match error {
        codex::ProviderError::Connection(error) => AppError::from(error),
        codex::ProviderError::Storage => AppError::FilesystemRequestFailed,
        codex::ProviderError::Unavailable => AppError::ModelCatalogUnavailable,
    }
}

#[tauri::command]
pub async fn list_models(app: AppHandle, state: State<'_, AppState>) -> Result<Value, AppError> {
    let connection = state.codex_connection().await?;
    let codex_home = state.codex_home().await?;
    let app_data = app_data_dir(&app)?;
    // API 可用时无需启动额外进程；第二层 CLI 按最新配置创建，第三层仍可兜底启动失败。
    codex::list_provider_models(&connection, &app_data, &codex_home, || async {
        let process = codex::CodexProcess::start(
            &app_data,
            &crate::infrastructure::bundled_runtime::root(&app)
                .map_err(|_| codex::ProviderError::Unavailable)?,
        )
        .await
        .map_err(|_| codex::ProviderError::Unavailable)?;
        Ok(codex::list_models(&process.connection()).await?)
    })
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
    let _ = app.emit("engine-configuration-changed", ());
    Ok(response)
}

#[tauri::command]
pub async fn get_global_settings(
    app: AppHandle,
    state: State<'_, AppState>,
    engine: Option<String>,
) -> Result<Value, AppError> {
    if engine.as_deref() == Some("claude") {
        // 公共偏好只读取应用存储；Claude 用户不需要启动或配置 Codex。
        let settings = super::generation_settings::read(&app).await?;
        return Ok(json!({"settings": settings}));
    }
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
    engine: Option<String>,
) -> Result<Value, AppError> {
    if engine.as_deref() == Some("claude") {
        let update = crate::infrastructure::local_settings::update_global_settings(
            &app_data_dir(&app)?,
            settings,
        )
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)?;
        return Ok(json!({"changedFields": update.changed_fields, "settings": update.settings}));
    }
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
    crate::infrastructure::app_data::directory(app).map_err(|_| AppError::FilesystemRequestFailed)
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
    app: AppHandle,
    project_id: String,
    task_id: String,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let task = super::claude_tasks::task(&app, &project_id, &task_id).await?;
    if task["provider"] == "claude" {
        // 按任务持久身份读取共用宿主，避免 Claude 上下文查询唤起 Codex。
        return state
            .claude
            .request(
                &app,
                "mcp.list",
                Some(super::claude_tasks::scope(&task)),
                json!({"taskId": task_id}),
            )
            .await;
    }
    let connection = state.codex_connection().await?;
    validate_task(&connection, &project_id, &task_id).await?;
    codex::list_mcp_servers(&connection, &task_id)
        .await
        .map_err(request_error)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn retry_mcp_servers(
    app: AppHandle,
    project_id: String,
    task_id: String,
    action: Option<String>,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let task = super::claude_tasks::task(&app, &project_id, &task_id).await?;
    if task["provider"] == "claude" {
        return state
            .claude
            .request(
                &app,
                "mcp.reload",
                Some(super::claude_tasks::scope(&task)),
                // 操作语义由共享宿主校验；状态刷新不再隐式等同于重连或配置重载。
                json!({"taskId": task_id, "action": action}),
            )
            .await;
    }
    let connection = state.codex_connection().await?;
    validate_task(&connection, &project_id, &task_id).await?;
    codex::reload_mcp_servers(&connection, &task_id)
        .await
        .map_err(request_error)
}

/// 只读本地汇总，不依赖模型运行时或聊天事件通道。
#[tauri::command]
pub async fn get_token_usage(app: AppHandle, input: Value) -> Result<Value, AppError> {
    Ok(super::sidebar_commands::local_catalog(&app)?
        .call("usage.query", input)
        .await?)
}
