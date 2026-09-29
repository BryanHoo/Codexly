use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager, State};

use super::{error::AppError, state::AppState, workspace_commands::project_root};
use crate::infrastructure::{codex, workspace};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateInput {
    branch: String,
    expected_snapshot: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartInput {
    root_path: String,
    worktree_path: String,
}

#[tauri::command(rename_all = "camelCase")]
pub async fn create_task_worktree(
    project_id: String,
    root_path: String,
    input: CreateInput,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let (_, root, _) = project_root(&state, &project_id, &root_path).await?;
    let worktree = workspace::create_worktree(&root, None, &input.branch, &input.expected_snapshot)
        .await
        .map_err(AppError::from)?;
    // 仅创建 Git 工作树，任务仍归属原项目，不注册额外项目。
    Ok(json!({ "worktree": worktree }))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn start_worktree_task(
    app: AppHandle,
    project_id: String,
    input: StartInput,
    state: State<'_, AppState>,
) -> super::task_creation::CreationResult {
    let digest = Sha256::digest(format!("{project_id}\0{}", input.worktree_path).as_bytes());
    let key: String = digest.iter().map(|byte| format!("{byte:02x}")).collect();
    let creation_project = project_id.clone();
    state
        .task_creations
        .run(&project_id, &key, async move {
            let state = app.state::<AppState>();
            let project_id = creation_project;
            let (connection, root, _) = project_root(&state, &project_id, &input.root_path).await?;
            // 验证目标确为该仓库的工作树，禁止客户端将任意目录绑定到项目。
            let worktree = workspace::switch_worktree(&root, None, &input.worktree_path)
                .await
                .map_err(AppError::from)?;
            let settings = codex::read_agent_runtime_settings(&connection)
                .await
                .map_err(AppError::from)?;
            let response = codex::start_task(
                &connection,
                project_id.clone(),
                Some(std::path::Path::new(&worktree.path)),
                &settings,
            )
            .await
            .map_err(AppError::from)?;
            state
                .remember_task_metadata(
                    &project_id,
                    [(response.task.id.as_str(), response.task.title.as_str())],
                )
                .await;
            Ok(response)
        })
        .await
}
