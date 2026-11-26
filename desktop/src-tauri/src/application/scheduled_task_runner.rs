use tauri::{AppHandle, Emitter, Manager};

use crate::domain::{conversation::AgentTurnOptions, scheduled_task::ScheduledTask};

use super::{error::AppError, state::AppState};

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
    _project_id: &str,
    options: &AgentTurnOptions,
) -> Result<&'static str, AppError> {
    use crate::domain::scheduled_task::{scheduled_task_engine, scheduled_task_model_valid};
    let engine = scheduled_task_engine(options).ok_or(AppError::ScheduledTaskInvalid)?;
    let defaults = app
        .state::<AppState>()
        .acp
        .host
        .request(
            app,
            "settings.read",
            None,
            serde_json::json!({"engine":engine}),
        )
        .await?;
    // 旧表单仍保存模型 ID，校验来源改为 Agent 的 ACP 模型选项。
    let efforts: Vec<_> = defaults["configOptions"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|option| option["category"] == "thought_level")
        .flat_map(|option| option["options"].as_array().into_iter().flatten())
        .map(|option| serde_json::json!({"id":option["value"]}))
        .collect();
    let models: Vec<_> = defaults["configOptions"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|option| option["category"] == "model")
        .flat_map(|option| option["options"].as_array().into_iter().flatten())
        .map(|option| serde_json::json!({"id":option["value"],"supportedReasoningEfforts":efforts}))
        .collect();
    if !scheduled_task_model_valid(options, &serde_json::json!({"data":models})) {
        return Err(AppError::ScheduledTaskInvalid);
    }
    Ok(engine)
}
