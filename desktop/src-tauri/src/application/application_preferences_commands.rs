use super::error::AppError;
use crate::infrastructure::{
    app_data,
    local_catalog::{
        LocalCatalog,
        application_preferences::{contract, encode},
    },
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::path::Path;
use tokio::io::AsyncReadExt;

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
enum Request {
    Read {},
    Patch { changes: Value },
}

async fn legacy(directory: &Path) -> Result<Value, AppError> {
    let file = match tokio::fs::File::open(directory.join("agent-settings.json")).await {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(contract()?["defaults"].clone());
        }
        Err(_) => return Err(AppError::FilesystemRequestFailed),
    };
    // 应用旧文件只读且限量，不能通过迁移解析 / 写入厂商配置；未知字段原样留在旧文件。
    let mut bytes = Vec::new();
    file.take(524289)
        .read_to_end(&mut bytes)
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    if bytes.len() > 524288 {
        return Err(AppError::FilesystemRequestFailed);
    }
    let source: Value =
        serde_json::from_slice(&bytes).map_err(|_| AppError::FilesystemRequestFailed)?;
    if source["version"] != 1 || !source["global"].is_object() {
        return Err(AppError::FilesystemRequestFailed);
    }
    let mut preferences = contract()?["defaults"].clone();
    for (key, value) in source["global"]
        .as_object()
        .ok_or(AppError::FilesystemRequestFailed)?
    {
        if preferences.get(key).is_some() {
            preferences[key] = value.clone();
        }
    }
    // 早期应用把辅助生成模型命名为 commitMessageModel；只处理这个应用字段别名。
    if source["global"].get("defaultModel").is_none()
        && let Some(model) = source["global"].get("commitMessageModel")
    {
        preferences["defaultModel"] = model.clone();
    }
    encode(&preferences, false)?;
    Ok(preferences)
}
pub(super) async fn read(catalog: &LocalCatalog, directory: &Path) -> Result<Value, AppError> {
    let value = catalog.call("app.preferences.read", json!({})).await?;
    if value.is_null() {
        legacy(directory).await
    } else {
        Ok(value)
    }
}
async fn deliver(directory: &Path, input: Value) -> Result<Value, AppError> {
    let request: Request = serde_json::from_value(input)
        .map_err(|_| AppError::Acp("Invalid application preferences request".into()))?;
    let catalog = LocalCatalog::at(directory)?;
    match request {
        Request::Read {} => read(&catalog, directory).await,
        Request::Patch { changes } => {
            encode(&changes, true)?;
            let baseline = read(&catalog, directory).await?;
            Ok(catalog
                .call(
                    "app.preferences.patch",
                    json!({"baseline":baseline,"changes":changes}),
                )
                .await?)
        }
    }
}

/// 主窗口专用的纯本地偏好命令；目录由应用提供，不接收前端来源、路径或运行时参数。
#[tauri::command]
pub async fn application_preferences_request(
    app: tauri::AppHandle,
    request: Value,
) -> Result<Value, AppError> {
    let directory = app_data::directory(&app).map_err(|_| AppError::FilesystemRequestFailed)?;
    deliver(&directory, request).await
}

#[cfg(test)]
#[path = "application_preferences_commands_tests.rs"]
mod tests;
