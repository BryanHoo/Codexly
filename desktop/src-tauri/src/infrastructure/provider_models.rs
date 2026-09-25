use std::{
    io,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;
use tokio::{fs, sync::Mutex};

const PROVIDER_MODELS_VERSION: u8 = 1;
const MAX_PROVIDER_MODELS_BYTES: usize = 2 * 1024 * 1024;
// 同一进程内串行化读写，配合原子替换避免重新连接与模型刷新互相覆盖。
static PROVIDER_MODELS_LOCK: Mutex<()> = Mutex::const_new(());

#[derive(Debug, Error)]
pub enum ProviderModelsError {
    #[error("invalid provider models data")]
    InvalidData,
    #[error(transparent)]
    Io(#[from] io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProviderModelsFile {
    base_url: String,
    models: Value,
    provider_id: String,
    version: u8,
}

pub async fn read_provider_models(
    app_data: &Path,
    provider_id: &str,
    base_url: &str,
) -> Result<Option<Value>, ProviderModelsError> {
    validate_identity(provider_id, base_url)?;
    let _guard = PROVIDER_MODELS_LOCK.lock().await;
    let bytes = match fs::read(provider_models_path(app_data)).await {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    if bytes.len() > MAX_PROVIDER_MODELS_BYTES {
        return Err(ProviderModelsError::InvalidData);
    }
    let stored: ProviderModelsFile = serde_json::from_slice(&bytes)?;
    validate_file(&stored)?;
    // 模型目录必须与当前 Provider 和端点同时匹配，不能跨代理地址复用。
    if stored.provider_id != provider_id || stored.base_url != base_url {
        return Ok(None);
    }
    Ok(Some(stored.models))
}

pub async fn write_provider_models(
    app_data: &Path,
    provider_id: &str,
    base_url: &str,
    models: &Value,
) -> Result<(), ProviderModelsError> {
    validate_identity(provider_id, base_url)?;
    validate_models(models)?;
    let _guard = PROVIDER_MODELS_LOCK.lock().await;
    let stored = ProviderModelsFile {
        base_url: base_url.to_owned(),
        models: models.clone(),
        provider_id: provider_id.to_owned(),
        version: PROVIDER_MODELS_VERSION,
    };
    let bytes = serde_json::to_vec(&stored)?;
    if bytes.len() > MAX_PROVIDER_MODELS_BYTES {
        return Err(ProviderModelsError::InvalidData);
    }
    let target = provider_models_path(app_data);
    super::atomic_file::write_bytes(&target, bytes).await?;
    Ok(())
}

fn validate_file(stored: &ProviderModelsFile) -> Result<(), ProviderModelsError> {
    if stored.version != PROVIDER_MODELS_VERSION {
        return Err(ProviderModelsError::InvalidData);
    }
    validate_identity(&stored.provider_id, &stored.base_url)?;
    validate_models(&stored.models)
}

fn validate_identity(provider_id: &str, base_url: &str) -> Result<(), ProviderModelsError> {
    let valid_provider = !provider_id.trim().is_empty()
        && provider_id.len() <= 256
        && !provider_id.contains(['\0', '\r', '\n']);
    let valid_url = (base_url.starts_with("https://") || base_url.starts_with("http://"))
        && base_url.len() <= 2_048
        && !base_url.chars().any(char::is_whitespace);
    (valid_provider && valid_url)
        .then_some(())
        .ok_or(ProviderModelsError::InvalidData)
}

fn validate_models(models: &Value) -> Result<(), ProviderModelsError> {
    let data = models
        .get("data")
        .and_then(Value::as_array)
        .filter(|data| !data.is_empty() && data.len() <= 1_000)
        .ok_or(ProviderModelsError::InvalidData)?;
    let cursor_valid = matches!(models.get("nextCursor"), Some(Value::Null))
        || models
            .get("nextCursor")
            .and_then(Value::as_str)
            .is_some_and(|cursor| cursor.len() <= 1_000);
    let models_valid = data.iter().all(|model| {
        model
            .get("id")
            .and_then(Value::as_str)
            .is_some_and(|id| !id.trim().is_empty() && id.len() <= 256)
            && model
                .get("displayName")
                .and_then(Value::as_str)
                .is_some_and(|name| !name.trim().is_empty() && name.len() <= 256)
    });
    (cursor_valid && models_valid)
        .then_some(())
        .ok_or(ProviderModelsError::InvalidData)
}

fn provider_models_path(app_data: &Path) -> PathBuf {
    app_data.join("providers/codex/custom-models.json")
}
