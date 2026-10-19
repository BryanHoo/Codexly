use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager, State};

use super::{error::AppError, state::AppState, task_workspace, workspace_commands::project_root};
use crate::infrastructure::workspace;

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
    engine: Option<String>,
}

#[tauri::command(rename_all = "camelCase")]
pub async fn create_task_worktree(
    app: AppHandle,
    project_id: String,
    root_path: String,
    input: CreateInput,
    _state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let (root, _) = project_root(&app, &project_id, &root_path).await?;
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
    // 引擎参与幂等身份，避免同一工作树的 Claude 请求返回先前的 Codex 任务。
    let engine = input.engine.as_deref().unwrap_or("codex");
    let digest =
        Sha256::digest(format!("{project_id}\0{}\0{engine}", input.worktree_path).as_bytes());
    let key: String = digest.iter().map(|byte| format!("{byte:02x}")).collect();
    let creation_project = project_id.clone();
    state
        .task_creations
        .run(&project_id, &key, async move {
            let state = app.state::<AppState>();
            let project_id = creation_project;
            let (root, _) = project_root(&app, &project_id, &input.root_path).await?;
            // 验证目标确为该仓库的工作树，禁止客户端将任意目录绑定到项目。
            let worktree = workspace::switch_worktree(&root, None, &input.worktree_path)
                .await
                .map_err(AppError::from)?;
            // 与普通任务复用本地目录创建：首次发送才启动所选引擎，Claude 不触碰 Codex。
            let response = task_workspace::start_task_for_engine(
                &app,
                project_id.clone(),
                input.engine.as_deref().unwrap_or("codex"),
                Some(std::path::Path::new(&worktree.path)),
            )
            .await?;
            state
                .remember_task_metadata(
                    &project_id,
                    [(response.task.id.as_str(), response.task.title.as_str())],
                )
                .await;
            state
                .publish_catalog_task_change(&app, &project_id, &response.task.id, None)
                .await;
            Ok(response)
        })
        .await
}
