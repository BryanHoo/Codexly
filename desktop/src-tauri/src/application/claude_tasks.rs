use super::{error::AppError, state::AppState};
use crate::{
    domain::conversation::{AgentPromptInput, AgentTaskSettings, AgentTurnOptions},
    infrastructure::{local_catalog::LocalCatalog, task_settings::write_task_settings},
};
use serde_json::{Value, json};
use tauri::{AppHandle, Manager};

pub async fn task(app: &AppHandle, project: &str, id: &str) -> Result<Value, AppError> {
    LocalCatalog::at(
        &app.path()
            .app_data_dir()
            .map_err(|_| AppError::FilesystemRequestFailed)?,
    )?
    .owned_task(project, id)
    .await
    .map_err(Into::into)
}

pub fn scope(task: &Value) -> Value {
    json!({"kind":if task["projectId"].is_null(){"temporary"}else{"project"},"id":task["projectId"].as_str().unwrap_or("temporary"),"rootPath":task["cwd"]})
}

pub async fn read(
    app: &AppHandle,
    project: &str,
    id: &str,
    task: &Value,
    cursor: Option<String>,
) -> Result<Value, AppError> {
    let state = app.state::<AppState>();
    state.remember_tasks(project, [id]).await;
    // 宿主返回经版本校验的快照，原生读取循环在同一有序响应帧上绑定 checkpoint。
    let mut response = state
        .claude
        .request(
            app,
            "task.read",
            Some(scope(task)),
            json!({"taskId":id,"options":cursor.map_or_else(|| json!({}), |cursor| json!({"cursor":cursor}))}),
        )
        .await?;
    let snapshot = response
        .get_mut("snapshot")
        .filter(|snapshot| snapshot.is_object())
        .ok_or_else(|| AppError::Claude("Claude snapshot boundary is missing".into()))?;
    if let Some(turns) = snapshot["turns"].as_array_mut() {
        for turn in turns {
            if let Some(items) = turn["items"].as_array_mut() {
                for item in items {
                    super::claude_host::normalize_item(item);
                }
            }
        }
    }
    snapshot["settings"] = serde_json::to_value(
        super::sidebar_task_settings::effective_task_settings(app, project, id).await?,
    )
    .map_err(|_| AppError::FilesystemRequestFailed)?;
    Ok(response)
}

pub async fn start(
    app: &AppHandle,
    project: &str,
    id: &str,
    task: &Value,
    input: AgentPromptInput,
    options: AgentTurnOptions,
) -> Result<Value, AppError> {
    let state = app.state::<AppState>();
    if options
        .engine_options
        .as_ref()
        .is_none_or(|value| value["engine"] != "claude")
    {
        return Err(AppError::Claude("Task engine options mismatch".into()));
    }
    let mut images = Vec::new();
    let mut files = Vec::new();
    let mut text_attachments = Vec::new();
    for attachment in &input.attachments {
        let path = attachment["id"]
            .as_str()
            .ok_or(AppError::FilesystemRequestFailed)?;
        match attachment["kind"].as_str() {
            Some("image") => images.push(json!({"path":path,"mediaType":attachment["mediaType"],"detail":attachment["detail"].as_str().unwrap_or("auto")})),
            Some("text") => text_attachments.push(json!({"name":attachment["name"],"text":tokio::fs::read_to_string(path).await.map_err(|_| AppError::FilesystemRequestFailed)?})),
            _ => files.push(json!({"path":path,"mediaType":attachment["mediaType"],"name":attachment["name"]})),
        }
    }
    state.remember_tasks(project, [id]).await;
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    write_task_settings(&app_data, project, id, &AgentTaskSettings::from(&options))
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    let turn = state.claude.request(app, "turn.start", Some(scope(task)), json!({"taskId":id,"input":{"text":input.text,"skills":input.skills,"images":images,"files":files,"textAttachments":text_attachments},"options":options})).await?;
    Ok(
        json!({"checkpoint":{"sequence":state.project_sequence(project).await,"sessionId":crate::infrastructure::codex::RUNTIME_SESSION_ID},"taskId":id,"turn":turn}),
    )
}
