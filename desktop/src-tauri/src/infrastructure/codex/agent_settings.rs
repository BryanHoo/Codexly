use std::path::Path;

use serde_json::{Value, json};
use thiserror::Error;
use tokio::sync::Mutex;

use super::{
    AppServerConnection, ConnectionError,
    config::{edit, read_config, write_config},
};
use crate::{domain::agent_configuration::AgentRuntimeSettings, infrastructure::local_settings};

const AGENT_FIELDS: [(&str, &str); 8] = [
    ("approvalPolicy", "approval_policy"),
    ("approvalsReviewer", "approvals_reviewer"),
    ("fastMode", "service_tier"),
    ("model", "model"),
    ("modelVerbosity", "model_verbosity"),
    ("reasoningEffort", "model_reasoning_effort"),
    ("sandboxMode", "sandbox_mode"),
    ("webSearch", "web_search"),
];
static UPDATE_LOCK: Mutex<()> = Mutex::const_new(());

#[derive(Debug, Error)]
pub enum AgentSettingsError {
    #[error(transparent)]
    Connection(#[from] ConnectionError),
    #[error(transparent)]
    Local(#[from] local_settings::LocalSettingsError),
}

fn apply_agent_config(settings: &mut Value, config: &Value) {
    for (field, key) in AGENT_FIELDS {
        if field == "fastMode" {
            settings[field] = json!(matches!(config[key].as_str(), Some("fast" | "priority")));
        } else if let Some(value) = config.get(key).filter(|value| !value.is_null()) {
            settings[field] = value.clone();
        }
    }
}

pub async fn read_global_settings(
    connection: &AppServerConnection,
    app_data: &Path,
) -> Result<Value, AgentSettingsError> {
    let mut settings = local_settings::read_global_settings(app_data).await?;
    // 不传 cwd，避免项目的 .codex/config.toml 污染全局设置页面。
    apply_agent_config(&mut settings, &read_config(connection).await?);
    Ok(settings)
}

pub async fn update_global_settings(
    connection: &AppServerConnection,
    app_data: &Path,
    settings: Value,
) -> Result<local_settings::SettingsUpdate, AgentSettingsError> {
    local_settings::validate_global_settings(&settings)?;
    let _guard = UPDATE_LOCK.lock().await;
    let current = read_global_settings(connection, app_data).await?;
    let changed_fields =
        local_settings::changed_fields(&current, &settings, &local_settings::GLOBAL_FIELDS);
    let edits = AGENT_FIELDS
        .iter()
        .filter(|(field, _)| current[*field] != settings[*field])
        .map(|(field, key)| {
            // Codex 使用 priority 表示快速路由，default 显式关闭模型目录的默认服务档位。
            let value = if *field == "fastMode" {
                json!(if settings[*field] == true {
                    "priority"
                } else {
                    "default"
                })
            } else {
                settings[*field].clone()
            };
            edit(key, value)
        })
        .collect::<Vec<_>>();
    if !edits.is_empty() {
        // 官方接口负责全局路径解析、配置校验、原子写入及运行时重载。
        write_config(connection, edits).await?;
    }
    local_settings::update_global_settings(app_data, settings).await?;
    Ok(local_settings::SettingsUpdate {
        changed_fields,
        settings: read_global_settings(connection, app_data).await?,
    })
}

pub async fn read_project_defaults(
    connection: &AppServerConnection,
    app_data: &Path,
    project_id: &str,
) -> Result<Value, AgentSettingsError> {
    if let Some(settings) = local_settings::read_project_defaults(app_data, project_id).await? {
        return Ok(settings);
    }
    // 已保存的项目覆盖值直接返回；只有未配置项目才读取最新全局默认值。
    Ok(local_settings::project_defaults_from_global(
        &read_global_settings(connection, app_data).await?,
    ))
}

pub async fn read_agent_runtime_settings(
    connection: &AppServerConnection,
) -> Result<AgentRuntimeSettings, ConnectionError> {
    let mut settings = local_settings::default_global_settings();
    apply_agent_config(&mut settings, &read_config(connection).await?);
    serde_json::from_value(settings).map_err(|_| ConnectionError::InvalidMessage)
}
