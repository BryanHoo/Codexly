use tauri::{AppHandle, Manager, State};

use super::{error::AppError, sidebar_task_settings::effective_task_settings, state::AppState};
use crate::{
    domain::sidebar::AgentTaskMutationResponse,
    infrastructure::{codex, task_settings::write_task_settings, temporary_workspace},
};

#[tauri::command(rename_all = "camelCase")]
pub async fn fork_task(
    app: AppHandle,
    project_id: String,
    task_id: String,
    last_turn_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<AgentTaskMutationResponse, AppError> {
    let connection = state.codex_connection().await?;
    let mut settings = effective_task_settings(&app, &project_id, &task_id).await?;
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    let response = codex::fork_task(
        &connection,
        &project_id,
        &task_id,
        last_turn_id.as_deref(),
        &mut settings,
    )
    .await
    .map_err(AppError::from)?;
    if project_id == super::task_workspace::TEMPORARY_PROJECT_ID {
        let result =
            async {
                let source = codex::task_working_directory(&connection, &project_id, &task_id)
                    .await
                    .map_err(AppError::from)?;
                let source = temporary_workspace::canonical_workspace(&app_data, &source)
                    .await
                    .map_err(|_| AppError::FilesystemRequestFailed)?;
                let pending = temporary_workspace::create(&app_data)
                    .await
                    .map_err(|_| AppError::FilesystemRequestFailed)?;
                let target =
                    match temporary_workspace::bind_task(&app_data, &pending, &response.task.id)
                        .await
                    {
                        Ok(target) => target,
                        Err(_) => {
                            let _ = temporary_workspace::remove(&app_data, &pending).await;
                            return Err(AppError::FilesystemRequestFailed);
                        }
                    };
                let prepared = async {
                    // 分叉复制工作文件后使用独立目录，删除分叉不会清理原任务的数据。
                    crate::infrastructure::temporary_task_storage::copy_workspace(&source, &target)
                        .await
                        .map_err(|_| AppError::FilesystemRequestFailed)?;
                    codex::update_task_workspace(&connection, &response.task.id, &target)
                        .await
                        .map_err(AppError::from)
                }
                .await;
                if prepared.is_err() {
                    let _ = temporary_workspace::remove(&app_data, &target).await;
                }
                prepared
            }
            .await;
        if let Err(error) = result {
            let _ = codex::delete_task(&connection, project_id, response.task.id).await;
            return Err(error);
        }
    }
    write_task_settings(&app_data, &project_id, &response.task.id, &settings)
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    super::task_workspace::allow_attachment_assets(&app, &project_id, &response.task.id).await?;
    state
        .remember_task_metadata(
            &project_id,
            [(response.task.id.as_str(), response.task.title.as_str())],
        )
        .await;
    Ok(response)
}
