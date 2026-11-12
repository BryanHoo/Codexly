use super::{error::AppError, state::AppState};
use crate::infrastructure::codex;
use serde_json::{Value, json};
use std::{path::Path, time::Duration};
use tauri::AppHandle;
use tokio::time::timeout;

/// 旧运行时保留原行为；ACP 分支不能调用此兼容实现。
pub(super) async fn generate(
    app: &AppHandle,
    state: &AppState,
    root: &Path,
    changes: &str,
    snapshot: &str,
) -> Result<Value, AppError> {
    let global_settings = super::generation_settings::read(app).await?;
    let settings = codex::resolve_commit_message_settings(&global_settings);
    if global_settings["defaultAgent"] == "claude" {
        // 只读取本地项目目录并复用 Claude 宿主的无工具请求，不启动 Codex 推理。
        let prompt = format!(
            "{}\n\n以下是选中的 Git 变更：\n{}",
            settings.prompt, changes
        );
        let message = state
            .claude
            .request(
                app,
                "commit.generate",
                None,
                json!({"prompt": prompt, "model": settings.model}),
            )
            .await?;
        let text = message
            .as_str()
            .filter(|text| !text.trim().is_empty() && text.len() <= 10000)
            .ok_or(AppError::FilesystemRequestFailed)?;
        return Ok(json!({"message": text, "snapshot": snapshot}));
    }
    let connection = state.codex_connection().await?;
    let thread_id = codex::start_commit_message_thread(&connection, root, &settings.model)
        .await
        .map_err(AppError::from)?;
    let completed = state.register_model_turn(&thread_id).await;
    if let Err(error) = codex::start_commit_message_turn(
        &connection,
        &thread_id,
        &settings.model,
        &settings.prompt,
        changes,
    )
    .await
    {
        state.cancel_model_turn(&thread_id).await;
        return Err(AppError::from(error));
    }
    let output = match timeout(Duration::from_secs(120), completed).await {
        Ok(Ok(Some(output))) => output,
        _ => {
            state.cancel_model_turn(&thread_id).await;
            return Err(AppError::CodexRequestFailed);
        }
    };
    let message =
        codex::parse_commit_message_output(&output).map_err(|_| AppError::CodexRequestFailed)?;
    Ok(json!({"message": message, "snapshot": snapshot}))
}
