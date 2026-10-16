use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

use super::{error::AppError, state::AppState};
use crate::{
    domain::sidebar::AgentTaskMutationResponse,
    infrastructure::{codex, temporary_workspace, workspace},
};

pub(crate) const TEMPORARY_PROJECT_ID: &str = "temporary";

pub(crate) async fn start_task(
    app: &AppHandle,
    project_id: String,
) -> Result<AgentTaskMutationResponse, AppError> {
    start_task_for_engine(app, project_id, "codex").await
}

pub(crate) async fn start_task_for_engine(
    app: &AppHandle,
    project_id: String,
    engine: &str,
) -> Result<AgentTaskMutationResponse, AppError> {
    if !matches!(engine, "codex" | "claude") {
        return Err(AppError::Claude("Unknown engine".into()));
    }
    use crate::infrastructure::local_catalog::{LocalCatalog, sidebar::map_task};
    use serde_json::json;
    let app_data = app_data_dir(app)?;
    let catalog = LocalCatalog::at(&app_data)?;
    let id = format!("task-{}", uuid::Uuid::new_v4());
    let temporary = project_id == TEMPORARY_PROJECT_ID;
    let cwd = if temporary {
        let staging = temporary_workspace::create(&app_data)
            .await
            .map_err(|_| AppError::FilesystemRequestFailed)?;
        match temporary_workspace::bind_task(&app_data, &staging, &id).await {
            Ok(path) => path,
            Err(_) => {
                let _ = temporary_workspace::remove(&app_data, &staging).await;
                return Err(AppError::FilesystemRequestFailed);
            }
        }
    } else {
        let project = catalog
            .call("project.read", json!({"id":project_id}))
            .await?;
        PathBuf::from(
            project["path"]
                .as_str()
                .ok_or(AppError::FilesystemRequestFailed)?,
        )
    };
    let task = json!({"id":id,"projectId":if temporary {None}else{Some(&project_id)},"title":"","cwd":cwd,
        "provider":engine,"sessionId":null,"updatedAt":chrono::Utc::now().timestamp_millis() as f64/1000.0,"pinned":false,"archived":false,"status":"notLoaded"});
    // 先保存应用任务，首次发送再创建执行会话；创建目录不需要模型目录或 Codex 连接。
    if let Err(error) = catalog.call("task.put", task.clone()).await {
        if temporary {
            let _ = temporary_workspace::remove(&app_data, &cwd).await;
        }
        return Err(error.into());
    }
    if temporary {
        allow_attachment_assets(app, &project_id, &id).await?;
    }
    Ok(AgentTaskMutationResponse {
        task: map_task(&task)?,
    })
}

pub(crate) async fn allow_attachment_assets(
    app: &AppHandle,
    project_id: &str,
    task_id: &str,
) -> Result<(), AppError> {
    if let Some(root) = crate::infrastructure::temporary_task_storage::root(
        &app_data_dir(app)?,
        project_id,
        task_id,
    )
    .await
    .map_err(|_| AppError::FilesystemRequestFailed)?
    {
        // 仅开放已登记任务的附件目录，不扩大到用户选择的整个文件夹。
        app.asset_protocol_scope()
            .allow_directory(root.join("attachments"), true)
            .map_err(|_| AppError::FilesystemRequestFailed)?;
    }
    Ok(())
}

pub(crate) async fn remove_deleted_workspace(
    app: &AppHandle,
    project_id: &str,
    task_id: &str,
    working_directory: Option<&Path>,
) -> Result<(), AppError> {
    if project_id != TEMPORARY_PROJECT_ID {
        return Ok(());
    }
    let Some(working_directory) = working_directory else {
        return Ok(());
    };
    let app_data = app_data_dir(app)?;
    if let Some(owned) =
        crate::infrastructure::temporary_workspace_settings::task_workspace(&app_data, task_id)
            .await
            .map_err(|_| AppError::FilesystemRequestFailed)?
    {
        return temporary_workspace::remove(&app_data, &owned)
            .await
            .map_err(|_| AppError::FilesystemRequestFailed);
    }
    // 未登记的历史分叉可能共用父任务目录；不允许按另一个任务的 ID 清理。
    if working_directory
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name != task_id && !name.starts_with("task-"))
    {
        return Ok(());
    }
    match temporary_workspace::canonical_workspace(&app_data, working_directory).await {
        Ok(workspace) => temporary_workspace::remove(&app_data, &workspace)
            .await
            .map_err(|_| AppError::FilesystemRequestFailed),
        // 历史任务可能保存了旧版安装目录 cwd；删除线程时只能跳过，绝不能扩大清理范围。
        Err(error)
            if matches!(
                error.kind(),
                std::io::ErrorKind::NotFound | std::io::ErrorKind::PermissionDenied
            ) =>
        {
            Ok(())
        }
        Err(_) => Err(AppError::FilesystemRequestFailed),
    }
}

pub(crate) async fn resolve_preview_root(
    state: &AppState,
    project_id: &str,
    task_id: Option<&str>,
    root_path: Option<&str>,
    path: &str,
) -> Result<PathBuf, AppError> {
    // 绝对文件路径已经包含定位信息；无需连接运行时或验证项目归属。
    if Path::new(path).is_absolute() {
        let path = Path::new(path);
        return Ok(path.parent().unwrap_or(path).to_path_buf());
    }
    if let Some(root_path) = root_path {
        return workspace::canonical_root(root_path)
            .await
            .map_err(|_| AppError::FilesystemRequestFailed);
    }
    let connection = state.codex_connection().await?;
    if let Some(task_id) = task_id {
        let cwd = codex::task_working_directory(&connection, project_id, task_id)
            .await
            .map_err(AppError::from)?;
        return workspace::canonical_root(cwd.to_str().ok_or(AppError::FilesystemRequestFailed)?)
            .await
            .map_err(|_| AppError::FilesystemRequestFailed);
    }

    let project = codex::read_project(&connection, project_id)
        .await
        .map_err(AppError::from)?;
    let configured_root = project
        .roots
        .first()
        .ok_or(AppError::FilesystemRequestFailed)?;
    workspace::canonical_root(&configured_root.path)
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)
}

pub(crate) fn relative_preview_path(root: &Path, path: &str) -> Result<String, AppError> {
    let candidate = Path::new(path);
    if !candidate.is_absolute() {
        return Ok(path.to_owned());
    }
    Ok(candidate
        .strip_prefix(root)
        .unwrap_or(candidate)
        .to_string_lossy()
        .into_owned())
}

fn app_data_dir(app: &AppHandle) -> Result<PathBuf, AppError> {
    app.path()
        .app_data_dir()
        .map_err(|_| AppError::FilesystemRequestFailed)
}

#[cfg(test)]
mod preview_tests {
    use super::*;

    #[tokio::test]
    async fn absolute_preview_should_not_require_a_project_or_running_codex() {
        let path = std::env::temp_dir().join("中文 报告.docx");
        let root = resolve_preview_root(
            &AppState::default(),
            TEMPORARY_PROJECT_ID,
            None,
            Some("missing-project-root"),
            path.to_str().unwrap(),
        )
        .await
        .unwrap();
        assert_eq!(
            root.join(relative_preview_path(&root, path.to_str().unwrap()).unwrap()),
            path
        );
    }
}
