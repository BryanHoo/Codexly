use super::{error::AppError, state::AppState};
use crate::{
    domain::conversation::{AgentPromptInput, AgentTaskSettings, AgentTurnOptions},
    infrastructure::{local_catalog::LocalCatalog, task_settings::write_task_settings},
};
use serde_json::{Value, json};
use tauri::{AppHandle, Manager};

pub async fn task(app: &AppHandle, project: &str, id: &str) -> Result<Value, AppError> {
    LocalCatalog::at(
        &crate::infrastructure::app_data::directory(app)
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
    summary: Option<bool>,
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
            // 与 Web 复用 Provider 的摘要契约，历史续页和过程展开各自保留读取模式。
            json!({"taskId":id,"options":read_options(cursor, summary)}),
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

fn read_options(cursor: Option<String>, summary: Option<bool>) -> Value {
    let mut options = json!({});
    if let Some(cursor) = cursor {
        options["cursor"] = json!(cursor);
    }
    if let Some(summary) = summary {
        options["summary"] = json!(summary);
    }
    options
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
    let provider_input = provider_input(app, project, id, input).await?;
    state.remember_tasks(project, [id]).await;
    let app_data = crate::infrastructure::app_data::directory(app)
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    write_task_settings(&app_data, project, id, &AgentTaskSettings::from(&options))
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    let turn = state
        .claude
        .request(
            app,
            "turn.start",
            Some(scope(task)),
            json!({"taskId":id,"input":provider_input,"options":options}),
        )
        .await?;
    Ok(
        json!({"checkpoint":{"sequence":state.project_sequence(project).await,"sessionId":crate::infrastructure::codex::runtime_session_id()},"taskId":id,"turn":turn}),
    )
}

/// 原始上传先经路径授权；历史/排队附件由宿主按任务复验，不信任前端传回的路径及元数据。
pub async fn provider_input(
    app: &AppHandle,
    project: &str,
    task: &str,
    mut input: AgentPromptInput,
) -> Result<Value, AppError> {
    let app_data = crate::infrastructure::app_data::directory(app)
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    let mut references = Vec::new();
    let mut uploaded = Vec::new();
    for attachment in std::mem::take(&mut input.attachments) {
        let id = attachment["id"]
            .as_str()
            .ok_or(AppError::FilesystemRequestFailed)?;
        if std::path::Path::new(id).is_absolute() {
            uploaded.push(attachment);
        } else {
            references.push(id.to_owned());
        }
    }
    input.attachments = uploaded;
    super::attachment_commands::resolve_prompt_attachments(&app_data, project, task, &mut input)
        .await?;
    for id in references {
        let exported = super::claude_attachments::export(app, project, task, &id).await?;
        let mut attachment = exported["attachment"].clone();
        let path = exported["path"]
            .as_str()
            .ok_or(AppError::FilesystemRequestFailed)?;
        attachment["id"] = json!(path);
        input.attachments.push(attachment);
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
    Ok(
        json!({"text":input.text,"skills":input.skills,"images":images,"files":files,"textAttachments":text_attachments}),
    )
}

/// 队列按任务持久引擎路由，Claude 分支不要求 Codex 在线。
pub async fn queue_request(
    app: &AppHandle,
    project: &str,
    task_id: &str,
    method: &str,
    mut params: Value,
) -> Result<Option<Value>, AppError> {
    let task = task(app, project, task_id).await?;
    if task["provider"] != "claude" {
        return Ok(None);
    }
    params["taskId"] = json!(task_id);
    let response = app
        .state::<AppState>()
        .claude
        .request(app, method, Some(scope(&task)), params)
        .await?;
    Ok(Some(response))
}

#[cfg(test)]
mod tests {
    use super::read_options;
    use serde_json::json;

    #[test]
    fn claude_read_preserves_summary_and_process_options() {
        assert_eq!(read_options(None, Some(true)), json!({"summary":true}));
        assert_eq!(
            read_options(Some("older".into()), Some(true)),
            json!({"cursor":"older","summary":true})
        );
        assert_eq!(
            read_options(Some("process".into()), Some(false)),
            json!({"cursor":"process","summary":false})
        );
        assert_eq!(read_options(None, None), json!({}));
    }
}
