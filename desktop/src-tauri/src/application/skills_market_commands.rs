use std::collections::{HashMap, HashSet};

use serde_json::{Value, json};
use tauri::State;

use super::{error::AppError, state::AppState};
use crate::infrastructure::{codex, workspace};

#[derive(Clone)]
struct InstalledSkillRoot {
    project_id: String,
    project_name: String,
    root_path: String,
}

fn map_project_skills(response: &Value, roots: &[InstalledSkillRoot]) -> Value {
    let roots_by_path = roots
        .iter()
        .map(|root| (root.root_path.as_str(), root))
        .collect::<HashMap<_, _>>();
    let mut seen_paths = HashSet::new();
    let mut data = Vec::new();

    for mut skill in response
        .get("data")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .cloned()
    {
        let Some(path) = skill.get("path").and_then(Value::as_str).map(str::to_owned) else {
            continue;
        };
        // Codex 会为每个 cwd 重复返回全局 Skill，按绝对路径去重可稳定列表与传输体积。
        if !seen_paths.insert(path) {
            continue;
        }
        if skill.get("scope").and_then(Value::as_str) == Some("repo")
            && let Some(root) = skill
                .get("cwd")
                .and_then(Value::as_str)
                .and_then(|cwd| roots_by_path.get(cwd))
            && let Some(object) = skill.as_object_mut()
        {
            object.insert("projectId".to_owned(), json!(root.project_id));
            object.insert("projectName".to_owned(), json!(root.project_name));
            object.insert("rootPath".to_owned(), json!(root.root_path));
        }
        if let Some(object) = skill.as_object_mut() {
            object.remove("cwd");
        }
        data.push(skill);
    }
    json!({"data": data, "nextCursor": null})
}

async fn discover_installed_skills(
    state: &State<'_, AppState>,
    force_reload: bool,
) -> Result<Value, AppError> {
    let connection = state.codex_connection().await?;
    let projects = codex::list_projects(&connection)
        .await
        .map_err(AppError::from)?;
    let roots = projects
        .data
        .into_iter()
        .flat_map(|project| {
            project
                .roots
                .into_iter()
                .map(move |root| InstalledSkillRoot {
                    project_id: project.id.clone(),
                    project_name: project.name.clone(),
                    root_path: root.path,
                })
        })
        .collect::<Vec<_>>();
    let cwds = roots
        .iter()
        .map(|root| root.root_path.as_str())
        .collect::<Vec<_>>();
    let response = codex::list_installed_skills(&connection, &cwds, force_reload)
        .await
        .map_err(AppError::from)?;
    Ok(map_project_skills(&response, &roots))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn list_installed_skills(
    force_reload: bool,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    // 直接返回本地发现结果，避免逐项读取市场来源文件造成额外磁盘开销。
    discover_installed_skills(&state, force_reload).await
}

#[tauri::command]
pub async fn list_configured_mcp_servers(state: State<'_, AppState>) -> Result<Value, AppError> {
    let connection = state.codex_connection().await?;
    codex::list_configured_mcp_servers(&connection)
        .await
        .map_err(AppError::from)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn open_skill_directory(
    path: String,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let response = discover_installed_skills(&state, false).await?;
    let discovered = response
        .get("data")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .any(|skill| skill.get("path").and_then(Value::as_str) == Some(path.as_str()));
    if !discovered {
        return Err(AppError::FilesystemRequestFailed);
    }
    let target = tokio::fs::canonicalize(&path)
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    if target.file_name().and_then(|name| name.to_str()) != Some("SKILL.md") {
        return Err(AppError::FilesystemRequestFailed);
    }
    workspace::reveal_path(&target)
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    Ok(json!({"status": "opened"}))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn set_skill_enabled(
    path: String,
    enabled: bool,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let connection = state.codex_connection().await?;
    codex::set_skill_enabled(&connection, &path, enabled)
        .await
        .map_err(AppError::from)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn set_mcp_server_enabled(
    name: String,
    enabled: bool,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let connection = state.codex_connection().await?;
    codex::set_mcp_server_enabled(&connection, &name, enabled)
        .await
        .map_err(AppError::from)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{InstalledSkillRoot, map_project_skills};

    #[test]
    fn installed_skills_should_be_deduplicated_and_keep_project_identity() {
        let roots = [
            InstalledSkillRoot {
                project_id: "project-a".to_owned(),
                project_name: "Project A".to_owned(),
                root_path: "/work".to_owned(),
            },
            InstalledSkillRoot {
                project_id: "project-b".to_owned(),
                project_name: "Project B".to_owned(),
                root_path: "/other".to_owned(),
            },
        ];
        let response = json!({"data": [
            {"cwd": "/work", "path": "/global/SKILL.md", "scope": "user"},
            {"cwd": "/other", "path": "/global/SKILL.md", "scope": "user"},
            {"cwd": "/other", "path": "/other/.agents/skills/lint/SKILL.md", "scope": "repo"}
        ]});

        let mapped = map_project_skills(&response, &roots);

        assert_eq!(mapped["data"].as_array().unwrap().len(), 2);
        assert_eq!(mapped["data"][1]["projectId"], "project-b");
        assert_eq!(mapped["data"][1]["projectName"], "Project B");
        assert_eq!(mapped["data"][1]["rootPath"], "/other");
        assert!(mapped["data"][1].get("cwd").is_none());
    }
}
