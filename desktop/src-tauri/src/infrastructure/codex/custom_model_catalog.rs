use std::{collections::BTreeMap, path::Path, sync::OnceLock, time::Duration};

use futures_util::StreamExt;
use reqwest::{
    Client,
    header::{HeaderMap, HeaderName, HeaderValue},
    redirect::Policy,
};
use serde_json::{Value, json};
use tokio::io::AsyncReadExt;

use super::auth::ProviderError;

const MAX_BYTES: usize = 1024 * 1024;
const MAX_MODELS: usize = 1000;
static CLIENT: OnceLock<Result<Client, reqwest::Error>> = OnceLock::new();

/// 原生目录不可用时查询兼容 API；仅保留端点实际声明的模型能力。
pub(super) async fn discover(
    config: &Value,
    provider_id: &str,
    base_url: &str,
    codex_home: &Path,
) -> Result<Value, ProviderError> {
    let provider = &config["model_providers"][provider_id];
    let headers = model_headers(provider, codex_home).await?;
    let client = CLIENT
        .get_or_init(|| {
            Client::builder()
                .timeout(Duration::from_secs(10))
                .redirect(Policy::none())
                .build()
        })
        .as_ref()
        .map_err(|_| ProviderError::Unavailable)?;
    // 禁止跟随携带密钥的重定向；超时覆盖响应正文，且读取时限制实际字节数。
    let response = client
        .get(format!("{}/models", base_url.trim_end_matches('/')))
        .headers(headers)
        .send()
        .await
        .map_err(|_| ProviderError::Unavailable)?;
    if !response.status().is_success()
        || response
            .content_length()
            .is_some_and(|size| size > MAX_BYTES as u64)
    {
        return Err(ProviderError::Unavailable);
    }
    let mut body = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| ProviderError::Unavailable)?;
        if body.len() + chunk.len() > MAX_BYTES {
            return Err(ProviderError::Unavailable);
        }
        body.extend_from_slice(&chunk);
    }
    map_catalog(&serde_json::from_slice(&body).map_err(|_| ProviderError::Unavailable)?)
}

async fn model_headers(provider: &Value, codex_home: &Path) -> Result<HeaderMap, ProviderError> {
    let mut headers = HeaderMap::new();
    if let Some(values) = provider["http_headers"].as_object() {
        for (name, value) in values {
            if let Some(value) = value.as_str() {
                insert_header(&mut headers, name, value)?;
            }
        }
    }
    if let Some(values) = provider["env_http_headers"].as_object() {
        for (name, variable) in values {
            if let Some(variable) = variable.as_str()
                && let Ok(value) = std::env::var(variable)
            {
                insert_header(&mut headers, name, &value)?;
            }
        }
    }
    let mut key = provider["experimental_bearer_token"]
        .as_str()
        .map(str::to_owned);
    if key.is_none()
        && let Some(variable) = provider["env_key"].as_str()
    {
        key = Some(std::env::var(variable).map_err(|_| ProviderError::Unavailable)?);
    }
    if key.is_none()
        && provider["requires_openai_auth"] != false
        && !headers.contains_key("authorization")
        && !headers.contains_key("x-api-key")
    {
        // 仅读取 API Key，不以 ChatGPT Token 代替第三方认证，也不输出任何认证内容。
        let file = tokio::fs::File::open(codex_home.join("auth.json"))
            .await
            .map_err(|_| ProviderError::Unavailable)?;
        let mut bytes = Vec::new();
        file.take(MAX_BYTES as u64 + 1)
            .read_to_end(&mut bytes)
            .await
            .map_err(|_| ProviderError::Unavailable)?;
        if bytes.len() > MAX_BYTES {
            return Err(ProviderError::Unavailable);
        }
        let auth: Value = serde_json::from_slice(&bytes).map_err(|_| ProviderError::Unavailable)?;
        key = auth["OPENAI_API_KEY"].as_str().map(str::to_owned);
    }
    if let Some(key) = key.filter(|key| !key.trim().is_empty()) {
        insert_header(&mut headers, "authorization", &format!("Bearer {key}"))?;
    }
    Ok(headers)
}

fn insert_header(headers: &mut HeaderMap, name: &str, value: &str) -> Result<(), ProviderError> {
    headers.insert(
        HeaderName::from_bytes(name.as_bytes()).map_err(|_| ProviderError::Unavailable)?,
        HeaderValue::from_str(value).map_err(|_| ProviderError::Unavailable)?,
    );
    Ok(())
}

fn map_catalog(value: &Value) -> Result<Value, ProviderError> {
    let (values, id_key, name_key) = if let Some(models) = value["models"].as_array() {
        (models, "slug", "display_name")
    } else if let Some(models) = value["data"].as_array() {
        (models, "id", "name")
    } else {
        return Err(ProviderError::Unavailable);
    };
    if values.len() > MAX_MODELS {
        return Err(ProviderError::Unavailable);
    }
    let mut models: BTreeMap<String, Value> = BTreeMap::new();
    for model in values {
        let Some(id) = model[id_key]
            .as_str()
            .map(str::trim)
            .filter(|id| !id.is_empty() && id.len() <= 256)
        else {
            continue;
        };
        let name = model[name_key]
            .as_str()
            .map(str::trim)
            .filter(|name| !name.is_empty() && name.len() <= 256)
            .unwrap_or(id);
        let mut efforts = Vec::new();
        let mut modalities = Vec::new();
        if let Some(values) = model["input_modalities"].as_array() {
            for value in values.iter().filter_map(Value::as_str) {
                if matches!(value, "text" | "image") && !modalities.contains(&value) {
                    modalities.push(value);
                }
            }
        }
        if let Some(advertised) = model["supported_reasoning_levels"].as_array() {
            for effort in advertised {
                let Some(id) = effort["effort"]
                    .as_str()
                    .map(str::trim)
                    .filter(|id| !id.is_empty() && id.len() <= 256)
                else {
                    continue;
                };
                if efforts.iter().any(|value: &Value| value["id"] == id) {
                    continue;
                }
                let description = effort["description"]
                    .as_str()
                    .unwrap_or_default()
                    .chars()
                    .take(1000)
                    .collect::<String>();
                efforts.push(json!({"id": id, "description": description}));
            }
        }
        if efforts.is_empty() {
            // 同一 ID 的后续展示名不能清除此前已声明的推理能力，与 Web 端共用样例一致。
            if let Some(existing) = models.get_mut(id) {
                existing["displayName"] = json!(name);
                if !modalities.is_empty() {
                    existing["inputModalities"] = json!(modalities);
                }
                continue;
            }
        }
        let advertised_default = model["default_reasoning_level"]
            .as_str()
            .unwrap_or("medium");
        let default = efforts
            .iter()
            .find(|value| value["id"] == advertised_default)
            .or_else(|| efforts.iter().find(|value| value["id"] == "medium"))
            .or_else(|| efforts.first())
            .and_then(|effort| effort["id"].as_str())
            .unwrap_or_default();
        let mut mapped = json!({
            "id": id, "displayName": name, "description": "", "isDefault": false,
            "defaultReasoningEffort": default, "supportedReasoningEfforts": efforts,
        });
        if !modalities.is_empty() {
            mapped["inputModalities"] = json!(modalities);
        }
        models.insert(id.to_owned(), mapped);
    }
    if models.is_empty() {
        return Err(ProviderError::Unavailable);
    }
    let mut data = models.into_values().collect::<Vec<_>>();
    if let Some(first) = data.first_mut() {
        first["isDefault"] = json!(true);
    }
    Ok(json!({"data":data,"nextCursor":null}))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shared_custom_catalog_contract_should_match_web() {
        let fixtures: Value = serde_json::from_str(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../packages/provider-codex/src/custom-model-catalog-fixtures.json"
        )))
        .unwrap();
        for fixture in fixtures.as_array().unwrap() {
            assert_eq!(
                map_catalog(&fixture["response"]).unwrap(),
                fixture["expected"],
                "{}",
                fixture["name"]
            );
        }
    }
}
