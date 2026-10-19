use super::{error::AppError, state::AppState};
use crate::domain::runtime::CodexRuntimeInstallProgress;
use crate::infrastructure::local_catalog::LocalCatalog;
use serde_json::{Value, json};
use tauri::{AppHandle, Emitter, Manager, ipc::Channel};

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
    let result = app
        .state::<AppState>()
        .claude
        .request(&app, &method, scope, params)
        .await?;
    if matches!(method.as_str(), "configure" | "disconnect") {
        let _ = app.emit("engine-configuration-changed", ());
    }
    Ok(result)
}

/// 兼容旧 IPC 的离线资源检查；不安装、不下载，也不启动宿主。
#[tauri::command(rename_all = "camelCase")]
pub async fn prepare_claude_runtime(
    app: AppHandle,
    on_progress: Channel<CodexRuntimeInstallProgress>,
) -> Result<(), AppError> {
    let resources = crate::infrastructure::bundled_runtime::root(&app)?;
    app.state::<AppState>()
        .claude
        .runtime
        .prepare(
            &resources,
            crate::infrastructure::bundled_runtime::claude_host()?,
            move |progress| {
                let _ = on_progress.send(progress);
            },
        )
        .await
        .map_err(AppError::Claude)?;
    Ok(())
}
