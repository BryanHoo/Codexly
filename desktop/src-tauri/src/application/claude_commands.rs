use super::{error::AppError, state::AppState};
use crate::infrastructure::local_catalog::LocalCatalog;
use serde_json::{Value, json};
use tauri::{AppHandle, Manager};

/// 设置命令独立于 Codex 初始化；只允许公开的配置操作，禁止调用任意宿主方法。
#[tauri::command(rename_all = "camelCase")]
pub async fn claude_engine_request(
    app: AppHandle,
    method: String,
    project_id: Option<String>,
    params: Value,
) -> Result<Value, AppError> {
    if !matches!(
        method.as_str(),
        "profile" | "configure" | "disconnect" | "settings.read" | "settings.write"
    ) {
        return Err(AppError::Claude(
            "Unsupported engine settings operation".into(),
        ));
    }
    let scope = if let Some(id) = project_id.filter(|id| id != "temporary") {
        let catalog = LocalCatalog::at(
            &app.path()
                .app_data_dir()
                .map_err(|_| AppError::FilesystemRequestFailed)?,
        )?;
        let project = catalog.call("project.read", json!({"id":id})).await?;
        Some(json!({"kind":"project","id":id,"rootPath":project["path"]}))
    } else {
        None
    };
    app.state::<AppState>()
        .claude
        .request(&app, &method, scope, params)
        .await
}
