use super::{error::AppError, state::AppState, task_workspace};
use serde_json::{Value, json};
use std::path::PathBuf;
use tauri::{AppHandle, State};

/// 输入优化使用公共辅助生成偏好；临时线程不进入聊天目录，也不执行工具。
#[tauri::command(rename_all = "camelCase")]
pub async fn optimize_prompt(
    app: AppHandle,
    project_id: String,
    text: String,
    agent_runtime: Option<String>,
    request_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    super::application_generation::validate(agent_runtime.as_deref(), request_id.as_deref())?;
    state
        .run_cancellable(request_id.as_deref(), async {
            if text.trim().is_empty() || text.chars().count() > 32_000 {
                return Err(AppError::FilesystemRequestFailed);
            }
            let directory = crate::infrastructure::app_data::directory(&app)
                .map_err(|_| AppError::FilesystemRequestFailed)?;
            let root = if project_id == task_workspace::TEMPORARY_PROJECT_ID {
                // 临时会话尚无项目目录，使用应用目录承载无工具的临时推理，不创建用户任务。
                directory
            } else {
                let catalog = crate::infrastructure::local_catalog::LocalCatalog::at(&directory)?;
                let project = crate::infrastructure::local_catalog::sidebar::map_project(
                    &catalog
                        .call("project.read", json!({"id": project_id}))
                        .await?,
                )?;
                PathBuf::from(
                    &project
                        .roots
                        .first()
                        .ok_or(AppError::FilesystemRequestFailed)?
                        .path,
                )
            };
            let text = super::application_generation::generate(
                &app,
                &state,
                &project_id,
                &root,
                "optimize",
                &text,
            )
            .await?;
            Ok(json!({"text":text}))
        })
        .await
}
