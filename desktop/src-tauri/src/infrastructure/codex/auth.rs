use std::{collections::HashSet, path::Path, time::Duration};

use serde::Serialize;
use serde_json::{Value, json};
use thiserror::Error;

use crate::infrastructure::provider_models::{
    ProviderModelsError, read_provider_models, write_provider_models,
};

use super::{
    catalogs::list_models,
    config::{edit, read_config, write_config},
    connection::{AppServerConnection, ConnectionError},
};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const DEFAULT_CUSTOM_PROVIDER_ID: &str = "OpenAI";

#[derive(Debug, Error)]
pub enum ProviderError {
    #[error(transparent)]
    Connection(#[from] ConnectionError),
    #[error("failed to access local provider models")]
    Storage,
}

impl From<ProviderModelsError> for ProviderError {
    fn from(_: ProviderModelsError) -> Self {
        Self::Storage
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AccountReadParams {
    refresh_token: bool,
}

#[derive(Serialize)]
struct LoginParams<'a> {
    #[serde(rename = "type")]
    kind: &'a str,
    #[serde(skip_serializing_if = "Option::is_none", rename = "apiKey")]
    api_key: Option<&'a str>,
    #[serde(
        skip_serializing_if = "Option::is_none",
        rename = "useHostedLoginSuccessPage"
    )]
    hosted_success: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "appBrand")]
    app_brand: Option<&'a str>,
}

pub async fn list_provider_models(
    connection: &AppServerConnection,
    app_data: &Path,
) -> Result<Value, ProviderError> {
    let config = read_config(connection).await?;
    if provider_mode(&config) == "custom" {
        let provider_id = selected_provider_id(&config);
        if let Some(base_url) = configured_custom_base_url(&config) {
            // 在线目录及当前 CLI 目录优先；只有两者均不可用才读取相同端点的旧快照。
            let cli_models = list_models(connection).await;
            if cli_models.as_ref().is_ok_and(model_page_has_data) {
                let mut models = cli_models?;
                normalize_custom_reasoning(&mut models);
                write_provider_models(app_data, provider_id, base_url, &models).await?;
                return Ok(models);
            }
            if let Some(mut models) = read_provider_models(app_data, provider_id, base_url)
                .await?
                .or_else(|| legacy_provider_models(&config, base_url))
            {
                normalize_custom_reasoning(&mut models);
                write_provider_models(app_data, provider_id, base_url, &models).await?;
                return Ok(models);
            }
            return Ok(cli_models?);
        }
    }
    Ok(list_models(connection).await?)
}

fn normalize_custom_reasoning(models: &mut Value) {
    let Some(data) = models.get_mut("data").and_then(Value::as_array_mut) else {
        return;
    };
    for model in data {
        let has_reasoning = model
            .get("supportedReasoningEfforts")
            .and_then(Value::as_array)
            .is_some_and(|efforts| {
                efforts.iter().any(|effort| {
                    effort
                        .get("id")
                        .and_then(Value::as_str)
                        .is_some_and(|id| id != "none")
                })
            });
        if !has_reasoning {
            model["defaultReasoningEffort"] = json!("medium");
            model["supportedReasoningEfforts"] = json!([
                {"description": "Low", "id": "low"},
                {"description": "Medium", "id": "medium"},
                {"description": "High", "id": "high"}
            ]);
        }
    }
}

pub async fn ensure_custom_model_discovery(
    connection: &AppServerConnection,
) -> Result<bool, ConnectionError> {
    let config = read_config(connection).await?;
    if provider_mode(&config) != "custom" {
        return Ok(false);
    }
    let Some(base_url) = configured_custom_base_url(&config) else {
        return Ok(false);
    };
    let catalog_url = format!("{}/models", base_url.trim_end_matches('/'));
    let provider_id = selected_provider_id(&config);
    let mut edits = Vec::new();
    if provider_id == "openai" {
        edits.push(edit("model_provider", json!(DEFAULT_CUSTOM_PROVIDER_ID)));
        edits.push(edit("openai_base_url", Value::Null));
        edits.push(edit(
            &format!("model_providers.{DEFAULT_CUSTOM_PROVIDER_ID}"),
            custom_provider_config(DEFAULT_CUSTOM_PROVIDER_ID, base_url),
        ));
    } else if config
        .pointer(&format!("/model_providers/{provider_id}/model_catalog_url"))
        .and_then(Value::as_str)
        != Some(catalog_url.as_str())
    {
        edits.push(edit(
            &format!("model_providers.{provider_id}.model_catalog_url"),
            json!(catalog_url),
        ));
    }
    if config.pointer("/features/api_key_model_discovery") != Some(&json!(true)) {
        edits.push(edit("features.api_key_model_discovery", json!(true)));
    }
    if edits.is_empty() {
        return Ok(false);
    }
    write_config(connection, edits).await?;
    Ok(true)
}

pub async fn get_provider_connection(
    connection: &AppServerConnection,
    pending_login: Option<Value>,
) -> Result<Value, ConnectionError> {
    let config = read_config(connection).await?;
    let response: Value = connection
        .request(
            "account/read",
            &AccountReadParams {
                refresh_token: false,
            },
            REQUEST_TIMEOUT,
        )
        .await?;
    let account = response.get("account").and_then(map_account);
    let requires_openai_auth = response
        .get("requiresOpenaiAuth")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let mode = provider_mode(&config);
    let state = if let Some(pending) = pending_login.as_ref() {
        pending
            .get("state")
            .and_then(Value::as_str)
            .unwrap_or("pending")
    // Codex 151 中无需 OpenAI 认证的 provider 即使没有 account 也已可用。
    } else if account.is_some() || !requires_openai_auth {
        "connected"
    } else {
        "disconnected"
    };
    Ok(json!({
        "account": account,
        "customBaseUrl": custom_base_url(&config),
        "mode": mode,
        "pendingLogin": pending_login,
        "state": state,
    }))
}

pub async fn start_official_provider_login(
    connection: &AppServerConnection,
) -> Result<Value, ConnectionError> {
    write_config(
        connection,
        vec![
            edit("model_provider", json!("openai")),
            edit("openai_base_url", Value::Null),
            edit("desktop.codeagent.provider", Value::Null),
        ],
    )
    .await?;
    let response: Value = connection
        .request(
            "account/login/start",
            &LoginParams {
                kind: "chatgpt",
                api_key: None,
                hosted_success: Some(true),
                app_brand: Some("codex"),
            },
            REQUEST_TIMEOUT,
        )
        .await?;
    let login_id = response
        .get("loginId")
        .and_then(Value::as_str)
        .ok_or(ConnectionError::InvalidMessage)?;
    let auth_url = response
        .get("authUrl")
        .and_then(Value::as_str)
        .ok_or(ConnectionError::InvalidMessage)?;
    let status = disconnected_status("official", None, Some(pending(login_id, None)));
    Ok(json!({"authUrl": auth_url, "loginId": login_id, "status": status}))
}

pub async fn cancel_provider_login(
    connection: &AppServerConnection,
    login_id: &str,
) -> Result<Value, ConnectionError> {
    if login_id.is_empty() {
        return Err(ConnectionError::InvalidMessage);
    }
    let _: Value = connection
        .request(
            "account/login/cancel",
            &json!({"loginId": login_id}),
            REQUEST_TIMEOUT,
        )
        .await?;
    Ok(json!({"status": disconnected_status("official", None, None)}))
}

pub async fn logout_provider(connection: &AppServerConnection) -> Result<Value, ConnectionError> {
    let _: Value = connection
        .request(
            "account/logout",
            &serde_json::Map::<String, Value>::new(),
            REQUEST_TIMEOUT,
        )
        .await?;
    Ok(json!({"status": disconnected_status("official", None, None)}))
}

pub async fn configure_custom_provider(
    connection: &AppServerConnection,
    app_data: &Path,
    input: Value,
) -> Result<Value, ProviderError> {
    let base_url = input
        .get("baseUrl")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| {
            (value.starts_with("https://") || value.starts_with("http://"))
                && value.len() <= 2_048
                && !value.chars().any(char::is_whitespace)
        })
        .ok_or(ConnectionError::InvalidMessage)?;
    let config = read_config(connection).await?;
    let existing_custom_provider_id = (provider_mode(&config) == "custom")
        .then(|| configured_provider_id(&config))
        .flatten();
    let provider_id = match existing_custom_provider_id {
        Some("openai") | None => DEFAULT_CUSTOM_PROVIDER_ID,
        Some(provider_id) => provider_id,
    };
    let submitted_models = match input.get("models") {
        Some(models) => map_custom_models(Some(models))?,
        None => empty_model_page(),
    };
    let models = if model_page_has_data(&submitted_models) {
        submitted_models
    } else {
        read_provider_models(app_data, provider_id, base_url)
            .await?
            .or_else(|| legacy_provider_models(&config, base_url))
            .unwrap_or_else(empty_model_page)
    };
    // 先保存可恢复目录，再清理旧 TOML，避免迁移过程中丢失用户模型。
    if model_page_has_data(&models) {
        write_provider_models(app_data, provider_id, base_url, &models).await?;
    }
    let mut edits = {
        let provider_name = config
            .get("model_providers")
            .and_then(Value::as_object)
            .and_then(|providers| providers.get(provider_id))
            .and_then(|provider| provider.get("name"))
            .and_then(non_empty_string)
            .unwrap_or(provider_id);
        let provider = custom_provider_config(provider_name, base_url);
        vec![edit(&format!("model_providers.{provider_id}"), provider)]
    };
    edits.push(edit("desktop.codeagent.provider", Value::Null));
    edits.push(edit("features.api_key_model_discovery", json!(true)));
    if existing_custom_provider_id.is_none() || existing_custom_provider_id == Some("openai") {
        edits.push(edit("model_provider", json!(DEFAULT_CUSTOM_PROVIDER_ID)));
    }
    if configured_openai_base_url(&config).is_some() {
        edits.push(edit("openai_base_url", Value::Null));
    }
    write_config(connection, edits).await?;

    if let Some(api_key) = input.get("apiKey").and_then(Value::as_str) {
        if api_key.is_empty() || api_key.len() > 16_384 {
            return Err(ConnectionError::InvalidMessage.into());
        }
        let _: Value = connection
            .request(
                "account/login/start",
                &LoginParams {
                    kind: "apiKey",
                    api_key: Some(api_key),
                    hosted_success: None,
                    app_brand: None,
                },
                REQUEST_TIMEOUT,
            )
            .await?;
    }

    Ok(json!({
        "models": models,
        "status": {
            "account": {"type": "apiKey"}, "customBaseUrl": base_url, "mode": "custom",
            "pendingLogin": null, "state": "connected"
        }
    }))
}

fn custom_provider_config(name: &str, base_url: &str) -> Value {
    json!({
        "name": name,
        "base_url": base_url,
        "model_catalog_url": format!("{}/models", base_url.trim_end_matches('/')),
        "wire_api": "responses",
        "requires_openai_auth": true,
    })
}

fn map_custom_models(value: Option<&Value>) -> Result<Value, ConnectionError> {
    let values = match value {
        None => Vec::new(),
        Some(Value::Array(values)) if values.len() <= 1_000 => values.clone(),
        _ => return Err(ConnectionError::InvalidMessage),
    };
    let mut ids = HashSet::new();
    let mut data = Vec::with_capacity(values.len());
    for (index, model) in values.iter().enumerate() {
        let id = model.get("id").and_then(Value::as_str).map(str::trim);
        let name = model.get("name").and_then(Value::as_str).map(str::trim);
        let (Some(id), Some(name)) = (id, name) else {
            return Err(ConnectionError::InvalidMessage);
        };
        if id.is_empty() || name.is_empty() || id.len() > 256 || name.len() > 256 || !ids.insert(id)
        {
            return Err(ConnectionError::InvalidMessage);
        }
        data.push(json!({
            "defaultReasoningEffort": "medium", "description": "Custom provider model",
            "displayName": name, "id": id, "isDefault": index == 0,
            "supportedReasoningEfforts": [
                {"description": "Low", "id": "low"},
                {"description": "Medium", "id": "medium"},
                {"description": "High", "id": "high"}
            ]
        }));
    }
    Ok(json!({"data": data, "nextCursor": null}))
}

fn empty_model_page() -> Value {
    json!({"data": [], "nextCursor": null})
}

fn model_page_has_data(models: &Value) -> bool {
    models
        .get("data")
        .and_then(Value::as_array)
        .is_some_and(|data| !data.is_empty())
}

fn legacy_provider_models(config: &Value, base_url: &str) -> Option<Value> {
    let private = config.pointer("/desktop/codeagent/provider")?;
    if private.get("customBaseUrl").and_then(Value::as_str) != Some(base_url) {
        return None;
    }
    let data = private
        .get("customModels")
        .and_then(Value::as_array)
        .filter(|data| !data.is_empty())?
        .clone();
    Some(json!({"data": data, "nextCursor": null}))
}

fn selected_provider_id(config: &Value) -> &str {
    configured_provider_id(config).unwrap_or("openai")
}

fn configured_provider_id(config: &Value) -> Option<&str> {
    config.get("model_provider").and_then(non_empty_string)
}

fn provider_mode(config: &Value) -> &'static str {
    // Codex 151 以 model_provider 选择服务，openai_base_url 会改写内置 OpenAI 端点。
    if selected_provider_id(config) != "openai" || configured_openai_base_url(config).is_some() {
        "custom"
    } else {
        "official"
    }
}

fn custom_base_url(config: &Value) -> Value {
    configured_custom_base_url(config)
        .map(str::to_owned)
        .map(Value::String)
        .unwrap_or(Value::Null)
}

fn configured_custom_base_url(config: &Value) -> Option<&str> {
    let provider_id = selected_provider_id(config);
    if provider_id == "openai" {
        return configured_openai_base_url(config);
    }
    config
        .get("model_providers")
        .and_then(Value::as_object)
        .and_then(|providers| providers.get(provider_id))
        .and_then(|provider| provider.get("base_url"))
        .and_then(non_empty_string)
}

fn configured_openai_base_url(config: &Value) -> Option<&str> {
    config.get("openai_base_url").and_then(non_empty_string)
}

fn non_empty_string(value: &Value) -> Option<&str> {
    value.as_str().filter(|value| !value.trim().is_empty())
}

fn map_account(account: &Value) -> Option<Value> {
    match account.get("type").and_then(Value::as_str)? {
        "apiKey" => Some(json!({"type": "apiKey"})),
        "chatgpt" => Some(json!({
            "email": account.get("email").cloned().unwrap_or(Value::Null),
            "planType": account.get("planType").cloned().unwrap_or(Value::Null),
            "type": "chatgpt"
        })),
        _ => None,
    }
}

fn pending(login_id: &str, error: Option<&str>) -> Value {
    json!({"error": error, "loginId": login_id, "state": if error.is_some() { "failed" } else { "pending" }})
}

fn disconnected_status(mode: &str, custom_base_url: Option<&str>, pending: Option<Value>) -> Value {
    let state = pending
        .as_ref()
        .and_then(|value| value.get("state"))
        .and_then(Value::as_str)
        .unwrap_or("disconnected");
    json!({
        "account": null, "customBaseUrl": custom_base_url, "mode": mode,
        "pendingLogin": pending, "state": state
    })
}
