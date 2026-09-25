use std::{
    io,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::fs;

use crate::domain::conversation::AgentTaskSettings;

#[derive(Debug, Error)]
pub enum TaskSettingsError {
    #[error("invalid task settings identifier")]
    InvalidIdentifier,
    #[error("invalid task settings data")]
    InvalidData,
    #[error(transparent)]
    Io(#[from] io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredTaskSettings {
    project_id: String,
    settings: AgentTaskSettings,
    task_id: String,
}

pub async fn read_task_settings(
    app_data: &Path,
    project_id: &str,
    task_id: &str,
) -> Result<Option<AgentTaskSettings>, TaskSettingsError> {
    let path = settings_path(app_data, project_id, task_id).await?;
    let bytes = match fs::read(path).await {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    let stored: StoredTaskSettings = serde_json::from_slice(&bytes)?;
    if stored.project_id != project_id || stored.task_id != task_id || !stored.settings.is_valid() {
        return Err(TaskSettingsError::InvalidData);
    }
    Ok(Some(stored.settings))
}

pub async fn write_task_settings(
    app_data: &Path,
    project_id: &str,
    task_id: &str,
    settings: &AgentTaskSettings,
) -> Result<(), TaskSettingsError> {
    if !settings.is_valid() {
        return Err(TaskSettingsError::InvalidData);
    }
    let target = settings_path(app_data, project_id, task_id).await?;
    let stored = StoredTaskSettings {
        project_id: project_id.to_owned(),
        settings: settings.clone(),
        task_id: task_id.to_owned(),
    };
    let bytes = serde_json::to_vec(&stored)?;
    super::atomic_file::write_bytes(&target, bytes).await?;
    Ok(())
}

pub async fn delete_task_settings(
    app_data: &Path,
    project_id: &str,
    task_id: &str,
) -> Result<(), TaskSettingsError> {
    let path = settings_path(app_data, project_id, task_id).await?;
    match fs::remove_file(path).await {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

pub async fn delete_project_task_settings(
    app_data: &Path,
    project_id: &str,
) -> Result<(), TaskSettingsError> {
    let path = project_path(app_data, project_id)?;
    match fs::remove_dir_all(path).await {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

async fn settings_path(
    app_data: &Path,
    project_id: &str,
    task_id: &str,
) -> Result<PathBuf, TaskSettingsError> {
    if !valid_identifier(task_id) {
        return Err(TaskSettingsError::InvalidIdentifier);
    }
    if let Some(root) = super::temporary_task_storage::root(app_data, project_id, task_id).await? {
        return Ok(root.join(".codeagent/task-settings.json"));
    }
    Ok(project_path(app_data, project_id)?.join(format!("{task_id}.json")))
}

fn project_path(app_data: &Path, project_id: &str) -> Result<PathBuf, TaskSettingsError> {
    if !valid_identifier(project_id) {
        return Err(TaskSettingsError::InvalidIdentifier);
    }
    Ok(app_data.join("task-settings").join(project_id))
}

fn valid_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}
