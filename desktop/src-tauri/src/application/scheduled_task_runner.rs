use std::time::Duration;

use serde_json::{Value, json};
use tauri::{AppHandle, Emitter, Manager};
use tokio::time::timeout;

use crate::{
    domain::{
        conversation::{AgentPromptInput, AgentTaskSettings, AgentTurnOptions},
        scheduled_task::ScheduledTask,
    },
    infrastructure::{codex, task_settings::write_task_settings},
};

use super::{error::AppError, sidebar_prompt_title::prompt_task_title, state::AppState};

pub(crate) async fn start_turn_for_task(
    app: &AppHandle,
    project_id: &str,
    task_id: &str,
    mut input: AgentPromptInput,
    options: AgentTurnOptions,
    state: &AppState,
) -> Result<Value, AppError> {
    // 计划任务直接进入此处；校验必须先于附件解析、设置写入及任何启动副作用。
    crate::domain::goal_input::validate_turn_input(&input, &options)?;
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    super::attachment_commands::resolve_prompt_attachments(
        &app_data, project_id, task_id, &mut input,
    )
    .await?;
    let connection = state.codex_connection().await?;
    // 在后端读取最新偏好，普通任务和计划任务共用，不增加 WebView 的逐轮传输字段。
    let settings = codex::read_agent_runtime_settings(&connection)
        .await
        .map_err(AppError::from)?;
    // App Server 可能先推送 turn/started，再返回响应，必须提前建立事件归属。
    state.remember_tasks(project_id, [task_id]).await;
    if let Some(task_title) = prompt_task_title(&input) {
        state
            .promote_task_title(project_id, task_id, task_title)
            .await;
    }
    write_task_settings(
        &app_data,
        project_id,
        task_id,
        &AgentTaskSettings::from(&options),
    )
    .await
    .map_err(|_| AppError::FilesystemRequestFailed)?;
    let title_prompt = codex::task_title::title_prompt(if input.text.trim().is_empty() {
        prompt_task_title(&input).unwrap_or("新任务")
    } else {
        &input.text
    });
    if options.goal_mode {
        codex::ensure_task_writer(&connection, project_id, task_id, &settings)
            .await
            .map_err(AppError::from)?;
        let result = start_goal_turn(&connection, project_id, task_id, input, options, state).await;
        if result.is_ok() {
            super::task_title_generation::spawn_task_title(
                app,
                connection,
                project_id,
                task_id,
                title_prompt,
            );
        }
        return result;
    }
    let mut response = codex::start_turn(
        &connection,
        project_id.to_owned(),
        task_id.to_owned(),
        input,
        options,
        &settings,
    )
    .await
    .map_err(AppError::from)?;
    super::task_title_generation::spawn_task_title(
        app,
        connection,
        project_id,
        task_id,
        title_prompt,
    );
    response.checkpoint.sequence = state.project_sequence(project_id).await;
    serde_json::to_value(response).map_err(|_| AppError::CodexRequestFailed)
}

async fn start_goal_turn(
    connection: &codex::AppServerConnection,
    project_id: &str,
    task_id: &str,
    input: AgentPromptInput,
    options: AgentTurnOptions,
    state: &AppState,
) -> Result<Value, AppError> {
    let (waiter_id, turn_started) = state.register_turn_started(task_id).await;
    let result = async {
        codex::update_thread_settings(connection, task_id, &options)
            .await
            .map_err(AppError::from)?;
        codex::set_goal_objective(connection, task_id, &input.text)
            .await
            .map_err(AppError::from)?;
        timeout(Duration::from_secs(30), turn_started)
            .await
            .map_err(|_| AppError::CodexRequestFailed)?
            .map_err(|_| AppError::CodexRequestFailed)
    }
    .await;
    let turn = match result {
        Ok(turn) => turn,
        Err(error) => {
            state.cancel_turn_started(task_id, waiter_id).await;
            return Err(error);
        }
    };
    Ok(json!({
        "checkpoint": {
            "sequence": state.project_sequence(project_id).await,
            "sessionId": codex::RUNTIME_SESSION_ID,
        },
        "taskId": task_id,
        "turn": turn,
    }))
}

pub(crate) async fn start_scheduled_task_turn(
    app: &AppHandle,
    scheduled: &ScheduledTask,
) -> Result<String, String> {
    // 已保存的旧计划也在执行前核对，避免先创建线程再报告无效 Goal。
    crate::domain::goal_input::validate_turn_input(&scheduled.prompt, &scheduled.turn_options)
        .map_err(|error| error.to_string())?;
    let state = app.state::<AppState>();
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    state
        .start_codex(app, &app_data)
        .await
        .map_err(|error| error.to_string())?;
    let connection = state
        .codex_connection()
        .await
        .map_err(|error| error.to_string())?;
    let mut response =
        super::task_workspace::start_task(app, &connection, scheduled.project_id.clone())
            .await
            .map_err(|error| error.to_string())?;
    let task_id = &response.task.id;
    state
        .remember_task_metadata(
            &scheduled.project_id,
            [(task_id.as_str(), response.task.title.as_str())],
        )
        .await;
    let result = start_turn_for_task(
        app,
        &scheduled.project_id,
        task_id,
        scheduled.prompt.clone(),
        scheduled.turn_options.clone(),
        &state,
    )
    .await;
    // 后端创建的 Task 不经过 WebView Mutation；启动尝试结束后主动通知主窗口补入左栏。
    // 即使启动 Turn 失败，已创建的线程仍应可见；通知失败不能让调度器重复启动任务。
    response.task.title = prompt_task_title(&scheduled.prompt)
        .unwrap_or(&scheduled.name)
        .to_owned();
    if let Err(error) = app.emit_to("main", "scheduled-task://started", &response.task) {
        crate::infrastructure::diagnostics::record_error("scheduled_task_notify_failed", error);
    }
    result.map_err(|error| error.to_string())?;
    Ok(response.task.id)
}
