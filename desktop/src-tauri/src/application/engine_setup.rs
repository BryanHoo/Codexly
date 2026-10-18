use super::error::AppError;
use serde_json::Value;
use std::{
    io::ErrorKind,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager};
use tokio::{fs::File, io::AsyncReadExt};

/// 读取配置及登录状态，不启动常驻引擎、不刷新凭据，也不把配置内容传给 WebView。
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
    if configured_at(&codex).await?
        || has_environment(&["OPENAI_API_KEY", "CODEX_API_KEY"])
        || keyring_login_configured(&app, &codex).await?
    {
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
    // 限制配置读取量；异常交给界面提示和重试，不能误判成全新安装。
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
            // 只有实际服务商配置可代表连接，单独的存储偏好不等于已经登录。
            if config
                .get("model_provider")
                .and_then(toml::Value::as_str)
                .filter(|provider| *provider != "openai")
                .and_then(|provider| config.get("model_providers")?.get(provider))
                .and_then(|provider| provider.get("base_url"))
                .and_then(toml::Value::as_str)
                .is_some_and(|url| !url.trim().is_empty())
            {
                return Ok(true);
            }
        }
    }
    Ok(false)
}

/// 凭据由 Codex 自己读取系统钥匙串；只在显式使用钥匙串时执行短命离线检查。
/// 不启动 app-server、不读取或向 WebView 暴露钥匙串内容，退出登录后不会因偏好残留而启用。
async fn keyring_login_configured(app: &AppHandle, codex: &Path) -> Result<bool, AppError> {
    let Some(raw) = read_optional(&codex.join("config.toml")).await? else {
        return Ok(false);
    };
    let config: toml::Value =
        toml::from_str(&raw).map_err(|_| AppError::FilesystemRequestFailed)?;
    if !matches!(
        config
            .get("cli_auth_credentials_store")
            .and_then(toml::Value::as_str),
        Some("keyring" | "auto")
    ) {
        return Ok(false);
    }
    let binary = crate::infrastructure::bundled_runtime::root(app)?
        .join("codex/bin")
        .join(format!("codex{}", std::env::consts::EXE_SUFFIX));
    let mut command = tokio::process::Command::new(binary);
    command
        .args(["login", "status"])
        .env("CODEX_HOME", codex)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x0800_0000);
    Ok(
        tokio::time::timeout(std::time::Duration::from_secs(5), command.status())
            .await
            .is_ok_and(|result| result.is_ok_and(|status| status.success())),
    )
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
            "model_provider = \"gateway\"\n[model_providers.gateway]\nbase_url = \"http://localhost:1234/v1\"\n",
        )
        .await
        .unwrap();
        assert!(configured_at(root.path()).await.unwrap());
    }

    #[tokio::test]
    async fn storage_preferences_and_incomplete_provider_do_not_enable_engines() {
        let root = tempfile::tempdir().unwrap();
        fs::write(
            root.path().join("config.toml"),
            "cli_auth_credentials_store = \"keyring\"\nmodel_provider = \"gateway\"\n",
        )
        .await
        .unwrap();
        fs::write(
            root.path().join("settings.json"),
            r#"{"env":{"ANTHROPIC_BASE_URL":"https://api.anthropic.com"}}"#,
        )
        .await
        .unwrap();
        assert!(!configured_at(root.path()).await.unwrap());
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
