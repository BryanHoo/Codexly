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
    let app_data = crate::infrastructure::app_data::directory(app)
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    let task = super::claude_tasks::task(app, project_id, task_id).await?;
    if task["provider"] == "claude" {
        return super::claude_tasks::start(app, project_id, task_id, &task, input, options).await;
    }
    super::attachment_commands::resolve_prompt_attachments(
        &app_data, project_id, task_id, &mut input,
    )
    .await?;
    if options.engine_options.is_some() {
        return Err(AppError::Claude("Task engine options mismatch".into()));
    }
    let connection = state.codex_connection().await?;
    // 在后端读取最新偏好，普通任务和计划任务共用，不增加 WebView 的逐轮传输字段。
    let settings = codex::read_agent_runtime_settings(&connection)
        .await
        .map_err(AppError::from)?;
    // App Server 可能先推送 turn/started，再返回响应，必须提前建立事件归属。
    state.remember_tasks(project_id, [task_id]).await;
    if let Some(task_title) = prompt_task_title(&input) {
        // 预览独立于正式名称，先落盘再启动执行；模型失败或应用退出后仍可直接恢复左栏。
        if task["title"] == "" && task["preview"].as_str().is_none_or(str::is_empty) {
            let preview: String = task_title.chars().take(1024).collect();
            super::sidebar_commands::local_catalog(app)?
                .call("task.preview", json!({"id":task_id,"preview":preview}))
                .await?;
        }
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
    // 保存有界正文，在后台读取最新标题提示词后再组装请求，避免重复嵌套内置指令。
    let title_prompt: String = (if input.text.trim().is_empty() {
        prompt_task_title(&input).unwrap_or("新任务")
    } else {
        &input.text
    })
    .chars()
    .take(1024)
    .collect();
    if options.goal_mode {
        // Goal 设置本身就可能启动回合，恢复到收到启动确认前同样不能被后台退订。
        let _subscription = connection
            .lock_task_subscription(task_id)
            .await
            .map_err(AppError::from)?;
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
            "sessionId": codex::runtime_session_id(),
        },
        "taskId": task_id,
        "turn": turn,
    }))
}

pub(crate) async fn start_scheduled_task_turn(
    app: &AppHandle,
    scheduled: &ScheduledTask,
) -> Result<String, super::scheduled_acp::LaunchFailure> {
    let directory = crate::infrastructure::app_data::directory(app)
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    let catalog = crate::infrastructure::local_catalog::LocalCatalog::at(&directory)
        .map_err(AppError::from)?;
    let project = scheduled.project_id.clone();
    let outcome = super::scheduled_acp::try_start(&directory, &catalog, scheduled, |params| {
        let app = app.clone();
        async move {
            super::acp_task_commands::acp_task_request(
                app,
                project,
                "prompt.start".into(),
                params,
                None,
            )
            .await
        }
    })
    .await;
    let task_id = match &outcome {
        Ok(Some(id)) => Some(id.as_str()),
        Err(failure) => failure.task_id.as_deref(),
        _ => None,
    };
    if let Some(id) = task_id {
        // 后端启动与失败留下的任务都通知原主窗口；通知失败不能改变已确认的提交结果。
        let notify = async {
            let task = catalog.owned_task(&scheduled.project_id, id).await?;
            let task = crate::infrastructure::local_catalog::sidebar::map_task(&task)?;
            app.state::<AppState>()
                .remember_task_metadata(
                    &scheduled.project_id,
                    [(task.id.as_str(), task.title.as_str())],
                )
                .await;
            app.emit_to("main", "scheduled-task://started", &task)
                .map_err(|_| AppError::FilesystemRequestFailed)
        };
        if let Err(error) = notify.await {
            crate::infrastructure::diagnostics::record_error("scheduled_acp_notify_failed", error);
        }
    }
    match outcome {
        Ok(Some(id)) => Ok(id),
        // 旧计划缺少已确认的 ACP 原始配置时明确停止，不能自动恢复旧 SDK 执行。
        Ok(None) => Err(AppError::ScheduledTaskInvalid.into()),
        Err(error) => Err(error),
    }
}

/// 保存与执行共用同一条模型校验路径，避免调度触发后才发现引擎或模型不匹配。
pub(crate) async fn validate_scheduled_task_options(
    app: &AppHandle,
    project_id: &str,
    options: &AgentTurnOptions,
) -> Result<&'static str, AppError> {
    use crate::domain::scheduled_task::{scheduled_task_engine, scheduled_task_model_valid};
    let engine = scheduled_task_engine(options).ok_or(AppError::ScheduledTaskInvalid)?;
    let models = if engine == "claude" {
        let profile = super::claude_commands::claude_engine_request(
            app.clone(),
            "profile".into(),
            Some(project_id.into()),
            json!({}),
        )
        .await?;
        profile["models"].clone()
    } else {
        let state = app.state::<AppState>();
        let app_data = crate::infrastructure::app_data::directory(app)
            .map_err(|_| AppError::FilesystemRequestFailed)?;
        state.start_codex(app, &app_data).await?;
        let connection = state.codex_connection().await?;
        codex::list_models(&connection)
            .await
            .map_err(AppError::from)?
    };
    if !scheduled_task_model_valid(options, &models) {
        return Err(AppError::ScheduledTaskInvalid);
    }
    Ok(engine)
}
