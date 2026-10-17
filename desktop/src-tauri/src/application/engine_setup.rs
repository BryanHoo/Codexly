use super::error::AppError;
use serde_json::Value;
use std::{
    io::ErrorKind,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager};
use tokio::{fs::File, io::AsyncReadExt};

/// 只读取既有配置的存在性，不启动进程、不刷新凭据，也不把任何配置内容传给 WebView。
#[tauri::command]
pub async fn get_configured_engines(app: AppHandle) -> Result<Vec<&'static str>, AppError> {
    let home = app
        .path()
        .home_dir()
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    let directory = |key: &str, fallback: &str| {
        std::env::var_os(key)
            .filter(|value| !value.is_empty())
            .map_or_else(|| home.join(fallback), PathBuf::from)
    };
    let codex = directory("CODEX_HOME", ".codex");
    let claude = directory("CLAUDE_CONFIG_DIR", ".claude");
    let mut engines = Vec::new();
    if configured_at(&codex).await? || has_environment(&["OPENAI_API_KEY", "CODEX_API_KEY"]) {
        engines.push("codex");
    }
    let account = read_optional(&directory("CLAUDE_CONFIG_DIR", "").join(".claude.json")).await?;
    let signed_in = match account.filter(|raw| !raw.trim().is_empty()) {
        Some(raw) => {
            let value: Value =
                serde_json::from_str(&raw).map_err(|_| AppError::FilesystemRequestFailed)?;
            value.get("oauthAccount").is_some_and(|account| {
                account
                    .as_object()
                    .is_some_and(|account| !account.is_empty())
            })
        }
        None => false,
    };
    if configured_at(&claude).await?
        || signed_in
        || has_environment(&[
            "ANTHROPIC_API_KEY",
            "ANTHROPIC_AUTH_TOKEN",
            "CLAUDE_CODE_OAUTH_TOKEN",
            "ANTHROPIC_BASE_URL",
            "CLAUDE_CODE_USE_BEDROCK",
            "CLAUDE_CODE_USE_VERTEX",
            "CLAUDE_CODE_USE_FOUNDRY",
        ])
    {
        engines.push("claude");
    }
    Ok(engines)
}

fn has_environment(keys: &[&str]) -> bool {
    keys.iter()
        .any(|key| std::env::var(key).is_ok_and(|value| !value.trim().is_empty() && value != "0"))
}

async fn read_optional(path: &Path) -> Result<Option<String>, AppError> {
    let file = match File::open(path).await {
        Ok(file) => file,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(AppError::FilesystemRequestFailed),
    };
    // 初始化检测限制单文件读取量；配置异常进入重试页，不能误判为全新安装。
    let mut raw = String::new();
    file.take(1_048_577)
        .read_to_string(&mut raw)
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    if raw.len() > 1_048_576 {
        return Err(AppError::FilesystemRequestFailed);
    }
    Ok(Some(raw))
}

fn has_text(value: &Value) -> bool {
    value
        .as_str()
        .is_some_and(|value| !value.trim().is_empty() && value != "0")
}

async fn configured_at(directory: &Path) -> Result<bool, AppError> {
    for name in [
        "auth.json",
        ".credentials.json",
        "settings.json",
        "config.toml",
    ] {
        let Some(raw) = read_optional(&directory.join(name)).await? else {
            continue;
        };
        if name.ends_with(".json") {
            if raw.trim().is_empty() {
                continue;
            }
            let value: Value =
                serde_json::from_str(&raw).map_err(|_| AppError::FilesystemRequestFailed)?;
            let configured = if name == "settings.json" {
                has_text(&value["apiKeyHelper"])
                    || [
                        "ANTHROPIC_API_KEY",
                        "ANTHROPIC_AUTH_TOKEN",
                        "ANTHROPIC_BASE_URL",
                        "CLAUDE_CODE_USE_BEDROCK",
                        "CLAUDE_CODE_USE_VERTEX",
                        "CLAUDE_CODE_USE_FOUNDRY",
                    ]
                    .iter()
                    .any(|key| has_text(&value["env"][key]))
            } else {
                has_text(&value["OPENAI_API_KEY"])
                    || has_text(&value["tokens"]["access_token"])
                    || has_text(&value["tokens"]["refresh_token"])
                    || has_text(&value["claudeAiOauth"]["accessToken"])
            };
            if configured {
                return Ok(true);
            }
        } else {
            let config: toml::Value =
                toml::from_str(&raw).map_err(|_| AppError::FilesystemRequestFailed)?;
            // 默认模型、项目信任等偏好不代表已连接。显式服务商或钥匙串存储可迁移旧配置。
            if config
                .get("model_provider")
                .and_then(toml::Value::as_str)
                .is_some_and(|value| !value.is_empty() && value != "openai")
                || config
                    .get("cli_auth_credentials_store")
                    .and_then(toml::Value::as_str)
                    .is_some_and(|value| value == "keyring" || value == "auto")
            {
                return Ok(true);
            }
        }
    }
    Ok(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::fs;

    #[tokio::test]
    async fn existing_configuration_survives_missing_runtime_and_expired_credentials() {
        let root = tempfile::tempdir().unwrap();
        fs::write(
            root.path().join("config.toml"),
            "model_provider = \"gateway\"\n",
        )
        .await
        .unwrap();
        assert!(configured_at(root.path()).await.unwrap());
    }

    #[tokio::test]
    async fn empty_installation_is_not_configuration() {
        let root = tempfile::tempdir().unwrap();
        fs::write(root.path().join("settings.json"), "{}")
            .await
            .unwrap();
        assert!(!configured_at(root.path()).await.unwrap());
    }

    #[tokio::test]
    async fn model_preferences_and_empty_credentials_do_not_skip_connection() {
        let root = tempfile::tempdir().unwrap();
        fs::write(
            root.path().join("settings.json"),
            r#"{"model":"sonnet","env":{"ANTHROPIC_DEFAULT_OPUS_MODEL":"model-id"}}"#,
        )
        .await
        .unwrap();
        fs::write(
            root.path().join("auth.json"),
            r#"{"OPENAI_API_KEY":null,"tokens":null}"#,
        )
        .await
        .unwrap();
        fs::write(root.path().join("config.toml"), "model = \"gpt-test\"\n")
            .await
            .unwrap();
        assert!(!configured_at(root.path()).await.unwrap());
    }

    #[tokio::test]
    async fn claude_api_configuration_is_detected_without_model_discovery() {
        let root = tempfile::tempdir().unwrap();
        fs::write(
            root.path().join("settings.json"),
            r#"{"env":{"ANTHROPIC_AUTH_TOKEN":"test-only"}}"#,
        )
        .await
        .unwrap();
        assert!(configured_at(root.path()).await.unwrap());
    }

    #[tokio::test]
    async fn credential_file_marks_existing_setup_without_exposing_its_content() {
        let root = tempfile::tempdir().unwrap();
        fs::write(
            root.path().join("auth.json"),
            r#"{"tokens":{"access_token":"expired"}}"#,
        )
        .await
        .unwrap();
        assert!(configured_at(root.path()).await.unwrap());
    }
}
