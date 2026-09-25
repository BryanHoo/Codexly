use std::path::{Path, PathBuf};

use serde::Deserialize;
use serde_json::{Value, json};
use tauri::{AppHandle, Manager, State};

use super::{error::AppError, state::AppState, task_workspace};
use crate::infrastructure::{codex, workspace};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenProjectInput {
    app_id: String,
    fallback_to_existing_ancestor: Option<bool>,
    path: Option<String>,
    task_id: Option<String>,
}

#[tauri::command(rename_all = "camelCase")]
pub async fn get_project_open_capabilities() -> Result<Value, AppError> {
    let (platform, apps) = workspace::platform_apps();
    Ok(json!({"apps": apps, "platform": platform}))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn open_project(
    project_id: String,
    root_path: Option<String>,
    input: OpenProjectInput,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let OpenProjectInput {
        app_id,
        fallback_to_existing_ancestor,
        path,
        task_id,
    } = input;
    // 绝对路径不依赖项目；相对路径由当前目录或任务 cwd 定位。
    let root = task_workspace::resolve_preview_root(
        &state,
        &project_id,
        task_id.as_deref(),
        root_path.as_deref(),
        path.as_deref().unwrap_or_default(),
    )
    .await?;
    let candidate = path
        .as_deref()
        .map_or_else(|| root.clone(), |path| root.join(path));
    let target =
        resolve_open_target(candidate, fallback_to_existing_ancestor.unwrap_or(false)).await?;
    workspace::open_path(&app_id, &target)
        .await
        .map_err(|_| AppError::FileOpenApplicationFailed)?;
    Ok(json!({"appId": app_id, "path": target.to_string_lossy()}))
}

async fn resolve_open_target(
    candidate: PathBuf,
    fallback_to_existing_ancestor: bool,
) -> Result<PathBuf, AppError> {
    let mut current = candidate;
    loop {
        match tokio::fs::canonicalize(&current).await {
            Ok(resolved) => return Ok(resolved),
            Err(error)
                if fallback_to_existing_ancestor
                    && error.kind() == std::io::ErrorKind::NotFound =>
            {
                // 生成失败可能连目标目录都未创建，回退到最近存在的祖先。
                current = current
                    .parent()
                    .filter(|parent| *parent != current)
                    .map(Path::to_path_buf)
                    .ok_or(AppError::FileOpenTargetUnavailable)?;
            }
            Err(_) => return Err(AppError::FileOpenTargetUnavailable),
        }
    }
}

#[tauri::command(rename_all = "camelCase")]
pub async fn open_task_attachment(
    app: AppHandle,
    project_id: String,
    task_id: String,
    attachment_id: String,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let connection = state.codex_connection().await?;
    codex::read_task(&connection, project_id.clone(), task_id.clone())
        .await
        .map_err(AppError::from)?;
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    let path = match crate::infrastructure::temporary_task_storage::validate_attachment(
        &app_data,
        &project_id,
        &task_id,
        &attachment_id,
    )
    .await
    {
        Ok(path) => path,
        Err(_) => workspace::validate_generated_attachment(&app_data, &attachment_id)
            .await
            .map_err(|_| AppError::FilesystemRequestFailed)?,
    };
    workspace::open_path("system-default", &path)
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    Ok(json!({"attachmentId": attachment_id, "status": "opened"}))
}

#[cfg(test)]
mod tests {
    use std::{
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };

    use super::resolve_open_target;

    #[tokio::test]
    async fn missing_open_target_should_return_an_actionable_error() {
        let error = resolve_open_target(test_directory("missing-file"), false)
            .await
            .unwrap_err();
        assert_eq!(
            serde_json::to_value(error).unwrap()["code"],
            "FILE_OPEN_TARGET_UNAVAILABLE"
        );
    }

    #[tokio::test]
    async fn system_default_should_resolve_office_files_without_a_project_root() {
        let directory = test_directory("office-external");
        tokio::fs::create_dir_all(&directory).await.unwrap();
        let file = directory.join("中文 报表.xlsx");
        tokio::fs::write(&file, b"PK\x03\x04").await.unwrap();
        let result = resolve_open_target(file.clone(), false).await;
        let expected = tokio::fs::canonicalize(file).await.unwrap();
        tokio::fs::remove_dir_all(directory).await.unwrap();
        assert_eq!(result.unwrap(), expected);
    }

    fn test_directory(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after Unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("codeagent-{name}-{nonce}"))
    }

    #[tokio::test]
    async fn containing_folder_should_fall_back_to_existing_workspace_ancestor() {
        let root = test_directory("open-containing-folder");
        tokio::fs::create_dir_all(&root)
            .await
            .expect("test root should be created");
        let root = tokio::fs::canonicalize(&root)
            .await
            .expect("test root should resolve");

        let target = resolve_open_target(root.join("missing/output"), true)
            .await
            .expect("missing folder should fall back to the managed workspace");

        assert_eq!(target, root);
        tokio::fs::remove_dir_all(&root)
            .await
            .expect("test root should be removed");
    }
}
