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
use std::path::{Path, PathBuf};
use tauri::Manager;
use tokio::io::AsyncReadExt;

async fn read_legacy_instructions(path: &Path, max_bytes: u64) -> Result<String, AppError> {
    let metadata = match tokio::fs::metadata(path).await {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(String::new()),
        Err(_) => return Err(AppError::FilesystemRequestFailed),
    };
    if !metadata.is_file() || metadata.len() > max_bytes {
        return Err(AppError::FilesystemRequestFailed);
    }
    let file = tokio::fs::File::open(path)
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    let mut content = String::new();
    // 多读一个字节识别被同时扩写的文件，不能提交截断内容。
    file.take(max_bytes + 1)
        .read_to_string(&mut content)
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    if content.len() as u64 > max_bytes {
        return Err(AppError::FilesystemRequestFailed);
    }
    Ok(content)
}

async fn import_legacy_instructions(
    directory: &Path,
    home: &Path,
    get_directory: impl Fn(&str) -> Option<PathBuf>,
) -> Result<(), AppError> {
    let catalog = LocalCatalog::at(directory)?;
    let saved = catalog.call("app.preferences.read", json!({})).await?;
    if saved.get("globalInstructions").is_some() {
        return Ok(());
    }
    let rules = &contract()?["legacyInstructions"];
    let max_bytes = rules["maxFileBytes"]
        .as_u64()
        .ok_or(AppError::FilesystemRequestFailed)?;
    // 与 Web 共用来源顺序。找到首份有效指令后立即提交，无需读取剩余文件。
    for source in rules["sources"]
        .as_array()
        .ok_or(AppError::FilesystemRequestFailed)?
    {
        let field = |key: &str| {
            source[key]
                .as_str()
                .ok_or(AppError::FilesystemRequestFailed)
        };
        let folder = get_directory(field("env")?).unwrap_or(home.join(field("directory")?));
        let content = read_legacy_instructions(&folder.join(field("file")?), max_bytes).await?;
        if content.trim().is_empty() {
            continue;
        }
        let baseline = if saved.is_null() {
            legacy(directory).await?
        } else {
            saved
        };
        catalog
            .call(
                "app.preferences.importInstructions",
                json!({"baseline":baseline,"content":content}),
            )
            .await?;
        return Ok(());
    }
    Ok(())
}

pub(crate) async fn migrate_global_instructions(app: &tauri::AppHandle) -> Result<(), AppError> {
    let home = app
        .path()
        .home_dir()
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    let directory = app_data::directory(app).map_err(|_| AppError::FilesystemRequestFailed)?;
    import_legacy_instructions(&directory, &home, |key| {
        std::env::var_os(key)
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
    })
    .await
}

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
