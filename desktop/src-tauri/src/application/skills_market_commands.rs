use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
};

use futures_util::{StreamExt, stream};
use serde::Deserialize;
use serde_json::{Value, json};
use tauri::{AppHandle, Manager, State};

use super::{error::AppError, state::AppState};
use crate::infrastructure::{codex, skills_market, workspace};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstalledOrigin {
    owner_handle: String,
    slug: String,
    installed_version: String,
}

async fn add_marketplace_origin(mut skill: Value) -> Value {
    let Some(path) = skill.get("path").and_then(Value::as_str) else {
        return skill;
    };
    let Some(origin_path) = PathBuf::from(path)
        .parent()
        .map(|root| root.join(".clawhub/origin.json"))
    else {
        return skill;
    };
    let Ok(metadata) = tokio::fs::metadata(&origin_path).await else {
        return skill;
    };
    if metadata.len() > 64 * 1024 {
        return skill;
    }
    let Some(origin) = tokio::fs::read(origin_path)
        .await
        .ok()
        .and_then(|bytes| serde_json::from_slice::<InstalledOrigin>(&bytes).ok())
    else {
        return skill;
    };
    if let Some(object) = skill.as_object_mut() {
        object.insert("source".to_owned(), json!("clawhub"));
        object.insert(
            "marketplace".to_owned(),
            json!({
                "installedVersion": origin.installed_version,
                "owner": origin.owner_handle,
                "slug": origin.slug,
            }),
        );
    }
    skill
}

async fn project_root(
    state: &State<'_, AppState>,
    project_id: Option<&str>,
    root_path: Option<&str>,
) -> Result<(std::sync::Arc<codex::AppServerConnection>, Option<PathBuf>), AppError> {
    let connection = state.codex_connection().await?;
    let Some(project_id) = project_id else {
        return Ok((connection, None));
    };
    let project = codex::read_project(&connection, project_id).await?;
    let path = project
        .roots
        .iter()
        .find(|root| root_path.is_none_or(|expected| root.path == expected))
        .ok_or(AppError::FilesystemRequestFailed)?
        .path
        .as_str();
    let root = workspace::canonical_root(path)
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    Ok((connection, Some(root)))
}

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
    let mut response = discover_installed_skills(&state, force_reload).await?;
    let items = response
        .get_mut("data")
        .and_then(Value::as_array_mut)
        .map(std::mem::take)
        .unwrap_or_default();
    let enriched = stream::iter(items.into_iter().map(add_marketplace_origin))
        .buffered(32)
        .collect::<Vec<_>>()
        .await;
    response["data"] = json!(enriched);
    Ok(response)
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

#[tauri::command(rename_all = "camelCase")]
pub async fn list_clawhub_skills(
    query: String,
    cursor: Option<String>,
    sort: String,
) -> Result<Value, AppError> {
    serde_json::to_value(
        skills_market::list_clawhub_skills(&query, cursor.as_deref(), &sort).await?,
    )
    .map_err(|_| AppError::SkillsMarket(skills_market::SkillsMarketError::InvalidResponse))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn get_clawhub_skill(owner: String, slug: String) -> Result<Value, AppError> {
    serde_json::to_value(skills_market::get_clawhub_skill(&owner, &slug).await?)
        .map_err(|_| AppError::SkillsMarket(skills_market::SkillsMarketError::InvalidResponse))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn install_clawhub_skill(
    app: AppHandle,
    owner: String,
    slug: String,
    scope: String,
    project_id: Option<String>,
    root_path: Option<String>,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let (connection, project) =
        project_root(&state, project_id.as_deref(), root_path.as_deref()).await?;
    let skills_root = match scope.as_str() {
        "project" => project
            .as_ref()
            .ok_or(AppError::FilesystemRequestFailed)?
            .join(".agents/skills"),
        "user" => app
            .path()
            .home_dir()
            .map_err(|_| AppError::HomeDirectoryUnavailable)?
            .join(".agents/skills"),
        _ => return Err(AppError::FilesystemRequestFailed),
    };
    let detail = skills_market::get_clawhub_skill(&owner, &slug).await?;
    if detail.scan_status != "clean" {
        return Err(AppError::SkillsMarket(
            skills_market::SkillsMarketError::Unsafe,
        ));
    }
    let version = detail.summary.latest_version;
    let archive = skills_market::download_skill_archive(&owner, &slug, &version).await?;
    let result: skills_market::InstallResult =
        skills_market::install_clawhub_archive(archive, skills_root, owner, slug, version).await?;
    // 安装发生在 app-server 外部，强制刷新发现缓存，保证列表立即可见。
    let refresh_cwds = project
        .as_deref()
        .and_then(|path| path.to_str())
        .into_iter()
        .collect::<Vec<_>>();
    let _ = codex::list_installed_skills(&connection, &refresh_cwds, true).await;
    Ok(json!(result))
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
