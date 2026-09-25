use std::{
    collections::BTreeMap,
    io,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use thiserror::Error;
use tokio::{fs, sync::Mutex};

#[path = "local_settings_types.rs"]
mod types;
use super::settings_object::{Object, object};
use types::{GlobalSettings, LocalPreferences, ProjectSettings};

const SETTINGS_VERSION: u8 = 1;
pub(crate) const GLOBAL_FIELDS: [&str; 13] = [
    "approvalPolicy",
    "approvalsReviewer",
    "commitMessageModel",
    "commitMessagePrompt",
    "defaultOpenAppId",
    "fastMode",
    "followUpBehavior",
    "model",
    "modelVerbosity",
    "pet",
    "reasoningEffort",
    "sandboxMode",
    "webSearch",
];
const LOCAL_FIELDS: [&str; 5] = [
    "commitMessageModel",
    "commitMessagePrompt",
    "defaultOpenAppId",
    "followUpBehavior",
    "pet",
];
const PROJECT_FIELDS: [&str; 6] = [
    "approvalPolicy",
    "approvalsReviewer",
    "fastMode",
    "model",
    "reasoningEffort",
    "sandboxMode",
];
static SETTINGS_LOCK: Mutex<()> = Mutex::const_new(());

#[derive(Debug, Error)]
pub enum LocalSettingsError {
    #[error("invalid local settings data")]
    InvalidData,
    #[error(transparent)]
    Io(#[from] io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

#[derive(Debug)]
pub struct SettingsUpdate {
    pub changed_fields: Vec<String>,
    pub settings: Value,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SettingsFile {
    #[serde(deserialize_with = "object")]
    global: LocalPreferences,
    projects: BTreeMap<String, Object<ProjectSettings>>,
    version: u8,
}

impl Default for SettingsFile {
    fn default() -> Self {
        Self {
            global: LocalPreferences::default(),
            projects: BTreeMap::new(),
            version: SETTINGS_VERSION,
        }
    }
}

pub async fn read_global_settings(app_data: &Path) -> Result<Value, LocalSettingsError> {
    let _guard = SETTINGS_LOCK.lock().await;
    global_value(&read_settings_file(app_data).await?.global)
}

pub async fn update_global_settings(
    app_data: &Path,
    settings: Value,
) -> Result<SettingsUpdate, LocalSettingsError> {
    let parsed = parse_global(&settings)?;
    let _guard = SETTINGS_LOCK.lock().await;
    let mut stored = read_settings_file(app_data).await?;
    let changed_fields = changed_fields(&global_value(&stored.global)?, &settings, &LOCAL_FIELDS);
    if !changed_fields.is_empty() {
        stored.global = parsed.into_local();
        write_settings_file(app_data, &stored).await?;
    }
    Ok(SettingsUpdate {
        changed_fields,
        settings,
    })
}

pub async fn read_project_defaults(
    app_data: &Path,
    project_id: &str,
) -> Result<Option<Value>, LocalSettingsError> {
    validate_identifier(project_id)?;
    let _guard = SETTINGS_LOCK.lock().await;
    let stored = read_settings_file(app_data).await?;
    stored
        .projects
        .get(project_id)
        .map(serde_json::to_value)
        .transpose()
        .map_err(Into::into)
}

pub async fn update_project_defaults(
    app_data: &Path,
    project_id: &str,
    settings: Value,
) -> Result<SettingsUpdate, LocalSettingsError> {
    validate_identifier(project_id)?;
    let parsed = parse_project(&settings)?;
    let _guard = SETTINGS_LOCK.lock().await;
    let mut stored = read_settings_file(app_data).await?;
    let current = stored
        .projects
        .get(project_id)
        .map(serde_json::to_value)
        .transpose()?
        .unwrap_or(Value::Null);
    let changed_fields = changed_fields(&current, &settings, &PROJECT_FIELDS);
    if !changed_fields.is_empty() {
        stored
            .projects
            .insert(project_id.to_owned(), Object(parsed));
        write_settings_file(app_data, &stored).await?;
    }
    Ok(SettingsUpdate {
        changed_fields,
        settings,
    })
}

async fn read_settings_file(app_data: &Path) -> Result<SettingsFile, LocalSettingsError> {
    let bytes = match fs::read(settings_path(app_data)).await {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(SettingsFile::default()),
        Err(error) => return Err(error.into()),
    };
    // 直接从字节构建固定配置结构，重复字段由 Serde 拒绝。
    let stored: SettingsFile = serde_json::from_slice(&bytes)?;
    if stored.version != SETTINGS_VERSION || !stored.global.is_valid() {
        return Err(LocalSettingsError::InvalidData);
    }
    for (project_id, settings) in &stored.projects {
        validate_identifier(project_id)?;
        if !settings.0.is_valid() {
            return Err(LocalSettingsError::InvalidData);
        }
    }
    Ok(stored)
}

async fn write_settings_file(
    app_data: &Path,
    settings: &SettingsFile,
) -> Result<(), LocalSettingsError> {
    super::atomic_file::write_bytes(&settings_path(app_data), serde_json::to_vec(settings)?)
        .await?;
    Ok(())
}

fn global_value(local: &LocalPreferences) -> Result<Value, LocalSettingsError> {
    let mut global = default_global_settings();
    if let Value::Object(fields) = serde_json::to_value(local)? {
        for (key, value) in fields {
            global[key] = value;
        }
    }
    Ok(global)
}

pub(crate) fn changed_fields(current: &Value, next: &Value, fields: &[&str]) -> Vec<String> {
    fields
        .iter()
        .filter(|field| current.get(**field) != next.get(**field))
        .map(|field| (*field).to_owned())
        .collect()
}

pub(crate) fn default_global_settings() -> Value {
    json!({
        "approvalPolicy": "on-request",
        "approvalsReviewer": "user",
        "commitMessageModel": "gpt-5.6-luna",
        "commitMessagePrompt": "",
        "defaultOpenAppId": null,
        "fastMode": false,
        "followUpBehavior": "queue",
        "model": "gpt-5.6-sol",
        "modelVerbosity": null,
        "pet": {"enabled": false, "selectedPetId": null},
        "reasoningEffort": "high",
        "sandboxMode": "workspace-write",
        "webSearch": "cached",
    })
}

pub(crate) fn project_defaults_from_global(global: &Value) -> Value {
    json!({
        "approvalPolicy": global["approvalPolicy"],
        "approvalsReviewer": global["approvalsReviewer"],
        "fastMode": global["fastMode"],
        "model": global["model"],
        "reasoningEffort": global["reasoningEffort"],
        "sandboxMode": global["sandboxMode"],
    })
}

pub(crate) fn validate_global_settings(settings: &Value) -> Result<(), LocalSettingsError> {
    parse_global(settings).map(|_| ())
}

fn parse_global(settings: &Value) -> Result<GlobalSettings, LocalSettingsError> {
    let parsed: GlobalSettings = object(settings).map_err(|_| LocalSettingsError::InvalidData)?;
    if !parsed.is_valid() {
        return Err(LocalSettingsError::InvalidData);
    }
    Ok(parsed)
}

fn parse_project(settings: &Value) -> Result<ProjectSettings, LocalSettingsError> {
    let parsed: ProjectSettings = object(settings).map_err(|_| LocalSettingsError::InvalidData)?;
    if !parsed.is_valid() {
        return Err(LocalSettingsError::InvalidData);
    }
    Ok(parsed)
}

fn validate_identifier(value: &str) -> Result<(), LocalSettingsError> {
    let valid = !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'));
    valid.then_some(()).ok_or(LocalSettingsError::InvalidData)
}

fn settings_path(app_data: &Path) -> PathBuf {
    app_data.join("agent-settings.json")
}
