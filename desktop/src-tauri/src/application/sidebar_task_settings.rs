use super::state::AppState;
use crate::infrastructure::task_settings::write_task_settings;
use serde_json::{Value, json};
use tauri::{AppHandle, Manager, State};

use super::error::AppError;
use crate::{
    domain::conversation::AgentTaskSettings,
    infrastructure::{codex, task_settings::read_task_settings},
};

pub(super) async fn effective_task_settings(
    app: &AppHandle,
    project_id: &str,
    task_id: &str,
) -> Result<AgentTaskSettings, AppError> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    if let Some(settings) = read_task_settings(&app_data, project_id, task_id)
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)?
    {
        return Ok(settings);
    }

    let task = super::claude_tasks::task(app, project_id, task_id).await?;
    if task["provider"] == "claude" {
        let defaults = app
            .state::<super::state::AppState>()
            .claude
            .request(app, "settings.read", None, serde_json::json!({}))
            .await?;
        return Ok(AgentTaskSettings {
            engine_options: Some(
                serde_json::json!({"engine":"claude","permissionMode":defaults["permissionMode"]}),
            ),
            model: defaults["model"].as_str().unwrap_or("default").into(),
            reasoning_effort: defaults["reasoningEffort"]
                .as_str()
                .unwrap_or_default()
                .into(),
            ..AgentTaskSettings::default()
        });
    }
    // 未配置 Task 专属设置时回退项目默认值，并在进入运行时前验证完整性。
    let connection = app
        .state::<super::state::AppState>()
        .codex_connection()
        .await?;
    let settings = codex::read_project_defaults(&connection, &app_data, project_id)
        .await
        .map_err(AppError::from)?;
    let settings: AgentTaskSettings =
        serde_json::from_value(settings).map_err(|_| AppError::FilesystemRequestFailed)?;
    if settings.is_valid() {
        Ok(settings)
    } else {
        Err(AppError::CodexRequestFailed)
    }
}

#[tauri::command(rename_all = "camelCase")]
pub async fn get_task_settings(
    app: AppHandle,
    project_id: String,
    task_id: String,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let task = super::claude_tasks::task(&app, &project_id, &task_id).await?;
    if task["provider"] == "claude" {
        return Ok(
            json!({"settings": effective_task_settings(&app, &project_id, &task_id).await?}),
        );
    }
    let connection = state.codex_connection().await?;
    codex::read_task(&connection, project_id.clone(), task_id.clone())
        .await
        .map_err(AppError::from)?;
    Ok(json!({
        "settings": effective_task_settings(&app, &project_id, &task_id).await?,
    }))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn update_task_settings(
    app: AppHandle,
    project_id: String,
    task_id: String,
    settings: AgentTaskSettings,
    turn_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    if !settings.is_valid() {
        return Err(AppError::CodexRequestFailed);
    }
    let task = super::claude_tasks::task(&app, &project_id, &task_id).await?;
    if task["provider"] == "claude" {
        if settings
            .engine_options
            .as_ref()
            .is_none_or(|value| value["engine"] != "claude")
        {
            return Err(AppError::Claude("Task engine options mismatch".into()));
        }
        write_task_settings(
            &app.path()
                .app_data_dir()
                .map_err(|_| AppError::FilesystemRequestFailed)?,
            &project_id,
            &task_id,
            &settings,
        )
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)?;
        return Ok(json!({"settings": settings, "reviewerUpdate":null}));
    }
    let connection = state.codex_connection().await?;
    codex::read_task(&connection, project_id.clone(), task_id.clone())
        .await
        .map_err(AppError::from)?;
    let reviewer_update = if let Some(turn_id) = turn_id
        && effective_task_settings(&app, &project_id, &task_id)
            .await?
            .approvals_reviewer
            != settings.approvals_reviewer
    {
        // 服务端拒绝时不落盘；回合已结束则只保存未来设置，明确返回未应用状态。
        Some(
            codex::update_live_reviewer(
                &connection,
                &task_id,
                &turn_id,
                &settings.approvals_reviewer,
            )
            .await
            .map_err(AppError::from)?,
        )
    } else {
        None
    };
    write_task_settings(
        &app.path()
            .app_data_dir()
            .map_err(|_| AppError::FilesystemRequestFailed)?,
        &project_id,
        &task_id,
        &settings,
    )
    .await
    .map_err(|_| AppError::FilesystemRequestFailed)?;
    Ok(json!({"settings": settings, "reviewerUpdate": reviewer_update}))
}
