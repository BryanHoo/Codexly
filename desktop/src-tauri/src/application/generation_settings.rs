use super::error::AppError;
use crate::infrastructure::local_settings;
use serde_json::{Value, json};
use std::path::Path;
use tauri::{AppHandle, Manager};

/// 只读取连接配置来选择辅助生成默认值，Claude 单独使用时不能启动 Codex。
pub(crate) async fn read(app: &AppHandle) -> Result<Value, AppError> {
    let app_data = crate::infrastructure::app_data::directory(app)
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    let mut settings = local_settings::read_global_settings(&app_data)
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    if settings["defaultAgent"] == "claude" {
        return Ok(settings);
    }
    let home = std::env::var_os("CODEX_HOME")
        .map(std::path::PathBuf::from)
        .or_else(|| app.path().home_dir().ok().map(|home| home.join(".codex")));
    if let Some(home) = home
        && !codex_configured(&home).await
    {
        settings["defaultAgent"] = json!("claude");
        settings["defaultModel"] = json!("haiku");
    }
    Ok(settings)
}

async fn codex_configured(home: &Path) -> bool {
    let (auth, config) = tokio::join!(
        tokio::fs::read(home.join("auth.json")),
        tokio::fs::read_to_string(home.join("config.toml"))
    );
    let authenticated = auth
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
        .is_some_and(|auth| {
            auth["OPENAI_API_KEY"]
                .as_str()
                .is_some_and(|key| !key.trim().is_empty())
                || auth
                    .pointer("/tokens/access_token")
                    .and_then(Value::as_str)
                    .is_some_and(|token| !token.trim().is_empty())
        });
    let custom = config
        .ok()
        .and_then(|text| toml::from_str::<toml::Value>(&text).ok())
        .is_some_and(|config| {
            config
                .get("model_provider")
                .and_then(toml::Value::as_str)
                .is_some_and(|provider| provider != "openai")
        });
    authenticated || custom
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn detect_configuration_without_starting_codex() {
        let directory = tempfile::tempdir().unwrap();
        assert!(!codex_configured(directory.path()).await);
        tokio::fs::write(
            directory.path().join("config.toml"),
            "model_provider = 'custom'\n",
        )
        .await
        .unwrap();
        assert!(codex_configured(directory.path()).await);
    }
}
