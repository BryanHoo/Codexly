use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager, State};

use super::{error::AppError, state::AppState, task_workspace, workspace_commands::project_root};
use crate::infrastructure::workspace;

async fn start_acp(
    directory: &std::path::Path,
    catalog: &crate::infrastructure::local_catalog::LocalCatalog,
    project: &str,
    input: &StartInput,
    key: &str,
) -> Result<crate::domain::sidebar::AgentTaskMutationResponse, AppError> {
    let (root, _) =
        super::workspace_commands::project_root_from_catalog(catalog, project, &input.root_path)
            .await?;
    let worktree = workspace::switch_worktree(&root, None, &input.worktree_path)
        .await
        .map_err(AppError::from)?;
    // 复用 ACP 独立身份与目录写入，创建不启动 agent，原历史绑定不被覆盖。
    let task = super::acp_task_creation::create_with_workspace(
        directory,
        catalog,
        project,
        input.engine.as_deref().unwrap_or("codex"),
        key,
        Some(&worktree.path),
    )
    .await?;
    Ok(crate::domain::sidebar::AgentTaskMutationResponse {
        task: crate::infrastructure::local_catalog::sidebar::map_task(&task)?,
    })
}

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
    agent_runtime: Option<String>,
    state: State<'_, AppState>,
) -> super::task_creation::CreationResult {
    // 引擎参与幂等身份，避免同一工作树的 Claude 请求返回先前的 Codex 任务。
    if agent_runtime.as_deref().is_some_and(|value| value != "acp") {
        return Err(json!(AppError::Acp("Invalid task runtime".into())));
    }
    let use_acp = agent_runtime.is_some();
    let engine = input.engine.as_deref().unwrap_or("codex");
    let digest = Sha256::digest(
        format!(
            "{project_id}\0{}\0{engine}{}",
            input.worktree_path,
            if use_acp { "\0acp" } else { "" }
        )
        .as_bytes(),
    );
    let key: String = digest.iter().map(|byte| format!("{byte:02x}")).collect();
    let acp_key = key.clone();
    let creation_project = project_id.clone();
    state
        .task_creations
        .run(&project_id, &key, async move {
            let state = app.state::<AppState>();
            let project_id = creation_project;
            let response = if use_acp {
                let directory = crate::infrastructure::app_data::directory(&app)
                    .map_err(|_| AppError::FilesystemRequestFailed)?;
                let catalog = crate::infrastructure::local_catalog::LocalCatalog::at(&directory)?;
                start_acp(&directory, &catalog, &project_id, &input, &acp_key).await?
            } else {
                let (root, _) = project_root(&app, &project_id, &input.root_path).await?;
                // 验证目标确为该仓库的工作树，禁止客户端将任意目录绑定到项目。
                let worktree = workspace::switch_worktree(&root, None, &input.worktree_path)
                    .await
                    .map_err(AppError::from)?;
                // 与普通任务复用本地目录创建：首次发送才启动所选引擎，Claude 不触碰 Codex。
                task_workspace::start_task_for_engine(
                    &app,
                    project_id.clone(),
                    input.engine.as_deref().unwrap_or("codex"),
                    Some(std::path::Path::new(&worktree.path)),
                )
                .await?
            };
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::local_catalog::LocalCatalog;
    #[tokio::test]
    async fn acp_worktree_creation_should_preserve_identity_and_authorization() {
        let root = tempfile::tempdir().unwrap();
        let repo = root.path().join("repo");
        let tree = root.path().join("tree");
        std::fs::create_dir(&repo).unwrap();
        let git = |args: &[&str]| {
            assert!(
                std::process::Command::new("git")
                    .current_dir(&repo)
                    .args(args)
                    .output()
                    .unwrap()
                    .status
                    .success()
            );
        };
        git(&["init"]);
        git(&[
            "-c",
            "user.name=ACP",
            "-c",
            "user.email=acp@example.test",
            "commit",
            "--allow-empty",
            "-m",
            "init",
        ]);
        git(&["worktree", "add", "-b", "test-tree", tree.to_str().unwrap()]);
        let catalog = LocalCatalog::at(&root.path().join("data")).unwrap();
        let project = catalog
            .add_project(vec![repo.to_str().unwrap().into()])
            .await
            .unwrap();
        for engine in ["codex", "claude"] {
            let input = StartInput {
                root_path: repo.to_str().unwrap().into(),
                worktree_path: tree.to_str().unwrap().into(),
                engine: Some(engine.into()),
            };
            let first = start_acp(root.path(), &catalog, &project.id, &input, engine)
                .await
                .unwrap();
            let again = start_acp(root.path(), &catalog, &project.id, &input, engine)
                .await
                .unwrap();
            assert_eq!(first.task.id, again.task.id);
            let saved = catalog
                .call("task.read", json!({"id":first.task.id}))
                .await
                .unwrap();
            assert_eq!(saved["provider"], engine);
            assert!(saved["sessionId"].is_null());
            assert_eq!(
                std::fs::canonicalize(saved["cwd"].as_str().unwrap()).unwrap(),
                std::fs::canonicalize(&tree).unwrap()
            );
            assert!(
                start_acp(root.path(), &catalog, "unknown", &input, engine)
                    .await
                    .is_err()
            );
            let outside = StartInput {
                worktree_path: root.path().to_str().unwrap().into(),
                ..input
            };
            assert!(
                start_acp(root.path(), &catalog, &project.id, &outside, "bad")
                    .await
                    .is_err()
            );
        }
    }
}
