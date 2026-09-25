use std::{path::Path, sync::Arc, time::Duration};

use tauri::{AppHandle, Manager};
use tokio::time::timeout;

use crate::infrastructure::{
    codex::{AppServerConnection, resolve_commit_message_settings, task_title},
    diagnostics, local_settings,
};

use super::{error::AppError, state::AppState};

pub(super) fn spawn_task_title(
    app: &AppHandle,
    connection: Arc<AppServerConnection>,
    project_id: &str,
    task_id: &str,
    prompt: String,
) {
    let Some(root) = task_title::take_task_title_root(&connection, task_id) else {
        return;
    };
    let app = app.clone();
    let project_id = project_id.to_owned();
    let task_id = task_id.to_owned();
    // 只在主请求成功后领取一次；辅助模型请求不延长发送链路，也不增加前端事件订阅。
    tauri::async_runtime::spawn(async move {
        let result = async {
            let app_data = app
                .path()
                .app_data_dir()
                .map_err(|_| AppError::FilesystemRequestFailed)?;
            generate_title(
                &app.state::<AppState>(),
                &connection,
                &root,
                &app_data,
                &prompt,
            )
            .await
        }
        .await;
        let result = match result {
            Ok(title) => task_title::apply_title(&connection, &project_id, &task_id, &title)
                .await
                .map_err(AppError::from),
            Err(error) => Err(error),
        };
        if result.is_err() {
            // 不记录提示正文或 Provider 错误细节；失败仅保留现有标题预览。
            diagnostics::record_error(
                "task_title_generation_failed",
                "automatic task title unavailable",
            );
        }
    });
}

pub(super) async fn generate_title(
    state: &AppState,
    connection: &AppServerConnection,
    root: &str,
    app_data: &Path,
    prompt: &str,
) -> Result<String, AppError> {
    // 与 Git 提交信息共用模型配置及默认值；在后台读取，不延长用户发送链路。
    let global_settings = local_settings::read_global_settings(app_data)
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    let settings = resolve_commit_message_settings(&global_settings);
    let thread_id = task_title::start_title_thread(connection, root, &settings.model)
        .await
        .map_err(AppError::from)?;
    // 先登记再发 turn/start，防止很快返回的模型输出丢失。
    let completed = state.register_model_turn(&thread_id).await;
    let mut active_turn = None;
    let result = timeout(Duration::from_secs(60), async {
        active_turn = Some(
            task_title::start_title_turn(connection, &thread_id, prompt)
                .await
                .map_err(AppError::from)?,
        );
        let output = completed
            .await
            .ok()
            .flatten()
            .ok_or(AppError::CodexRequestFailed)?;
        task_title::parse_title(&output).map_err(AppError::from)
    })
    .await
    .unwrap_or(Err(AppError::CodexRequestFailed));
    state.cancel_model_turn(&thread_id).await;
    task_title::release_title_thread(
        connection,
        &thread_id,
        if result.is_err() {
            active_turn.as_deref()
        } else {
            None
        },
    )
    .await;
    result
}
