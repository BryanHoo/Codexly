use std::{
    collections::{BTreeMap, HashSet, hash_map::DefaultHasher},
    hash::{Hash, Hasher},
    path::Path,
    sync::atomic::{AtomicU64, Ordering},
    time::Duration,
    time::SystemTime,
};

use serde::{Deserialize, Serialize};

use super::connection::{AppServerConnection, ConnectionError};
use crate::domain::sidebar::{
    Project, ProjectMutationResponse, ProjectPage, ProjectRoot, RemoveProjectResponse,
};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
static IDEMPOTENCY_SEQUENCE: AtomicU64 = AtomicU64::new(1);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectListParams<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    cursor: Option<&'a str>,
    limit: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeProjectPage {
    data: Vec<NativeProject>,
    next_cursor: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeProject {
    created_at: i64,
    id: String,
    name: String,
    position: i64,
    roots: Vec<NativeProjectRoot>,
}

#[derive(Deserialize)]
struct NativeProjectRoot {
    path: String,
}

#[derive(Deserialize)]
struct NativeProjectResponse {
    project: NativeProject,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectCreateParams {
    idempotency_key: String,
    metadata: BTreeMap<String, String>,
    name: String,
    roots: Vec<NativeProjectRootParam>,
}

#[derive(Serialize)]
struct NativeProjectRootParam {
    path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectUpdateParams {
    project_id: String,
    name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectIdParams {
    project_id: String,
}

pub async fn read_project(
    connection: &AppServerConnection,
    project_id: &str,
) -> Result<Project, ConnectionError> {
    let response: NativeProjectResponse = connection
        .request(
            "project/read",
            &ProjectIdParams {
                project_id: project_id.to_owned(),
            },
            REQUEST_TIMEOUT,
        )
        .await?;
    if response.project.id != project_id {
        return Err(ConnectionError::InvalidMessage);
    }
    Ok(map_project(response.project))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectMoveParams<'a> {
    before_project_id: Option<&'a str>,
    project_id: &'a str,
}

pub async fn list_projects(
    connection: &AppServerConnection,
) -> Result<ProjectPage, ConnectionError> {
    let mut projects = Vec::new();
    let mut cursor = None;
    let mut seen_cursors = HashSet::new();

    loop {
        let response: NativeProjectPage = connection
            .request(
                "project/list",
                &ProjectListParams {
                    cursor: cursor.as_deref(),
                    limit: 100,
                },
                REQUEST_TIMEOUT,
            )
            .await?;
        projects.extend(response.data);
        let Some(next_cursor) = response.next_cursor else {
            break;
        };
        if !seen_cursors.insert(next_cursor.clone()) {
            return Err(ConnectionError::InvalidMessage);
        }
        cursor = Some(next_cursor);
    }

    projects.sort_unstable_by(|left, right| {
        left.position
            .cmp(&right.position)
            .then_with(|| left.id.cmp(&right.id))
    });
    let data = projects.into_iter().map(map_project).collect();
    Ok(ProjectPage {
        data,
        next_cursor: None,
    })
}

pub async fn add_project(
    connection: &AppServerConnection,
    root_paths: Vec<String>,
) -> Result<ProjectMutationResponse, ConnectionError> {
    let Some(primary_root) = root_paths.first() else {
        return Err(ConnectionError::InvalidMessage);
    };
    if root_paths.iter().any(|path| path.is_empty()) {
        return Err(ConnectionError::InvalidMessage);
    }
    let name = Path::new(primary_root)
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or(primary_root)
        .to_owned();
    let response: NativeProjectResponse = connection
        .request(
            "project/create",
            &ProjectCreateParams {
                idempotency_key: next_idempotency_key(),
                metadata: BTreeMap::new(),
                name,
                roots: root_paths
                    .into_iter()
                    .map(|path| NativeProjectRootParam { path })
                    .collect(),
            },
            REQUEST_TIMEOUT,
        )
        .await?;
    Ok(ProjectMutationResponse {
        project: map_project(response.project),
    })
}

pub async fn rename_project(
    connection: &AppServerConnection,
    project_id: String,
    name: String,
) -> Result<ProjectMutationResponse, ConnectionError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(ConnectionError::InvalidMessage);
    }
    let response: NativeProjectResponse = connection
        .request(
            "project/update",
            &ProjectUpdateParams {
                project_id,
                name: name.to_owned(),
            },
            REQUEST_TIMEOUT,
        )
        .await?;
    Ok(ProjectMutationResponse {
        project: map_project(response.project),
    })
}

pub async fn remove_project(
    connection: &AppServerConnection,
    project_id: String,
) -> Result<RemoveProjectResponse, ConnectionError> {
    let _: serde_json::Value = connection
        .request(
            "project/delete",
            &ProjectIdParams {
                project_id: project_id.clone(),
            },
            REQUEST_TIMEOUT,
        )
        .await?;
    Ok(RemoveProjectResponse {
        project_id,
        status: "removed",
    })
}

pub async fn reorder_projects(
    connection: &AppServerConnection,
    project_ids: Vec<String>,
) -> Result<ProjectPage, ConnectionError> {
    if project_ids.is_empty()
        || project_ids.iter().collect::<HashSet<_>>().len() != project_ids.len()
    {
        return Err(ConnectionError::InvalidMessage);
    }
    for index in (0..project_ids.len()).rev() {
        let _: serde_json::Value = connection
            .request(
                "project/move",
                &ProjectMoveParams {
                    before_project_id: project_ids.get(index + 1).map(String::as_str),
                    project_id: &project_ids[index],
                },
                REQUEST_TIMEOUT,
            )
            .await?;
    }
    list_projects(connection).await
}

fn next_idempotency_key() -> String {
    let nanos = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map_or(0, |duration| duration.as_nanos());
    let sequence = IDEMPOTENCY_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    format!("codeagent-{nanos}-{sequence}")
}

fn map_project(project: NativeProject) -> Project {
    Project {
        created_at: unix_seconds_to_rfc3339(project.created_at),
        id: project.id,
        name: project.name,
        roots: project
            .roots
            .into_iter()
            .map(|root| ProjectRoot {
                id: stable_path_id(&root.path),
                path: root.path,
            })
            .collect(),
    }
}

fn stable_path_id(path: &str) -> String {
    let mut hasher = DefaultHasher::new();
    path.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

pub(super) fn unix_seconds_to_rfc3339(seconds: i64) -> String {
    let days = seconds.div_euclid(86_400);
    let seconds_of_day = seconds.rem_euclid(86_400);
    let shifted_days = days + 719_468;
    let era = shifted_days.div_euclid(146_097);
    let day_of_era = shifted_days - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let mut year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_prime = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_prime + 2) / 5 + 1;
    let month = month_prime + if month_prime < 10 { 3 } else { -9 };
    year += i64::from(month <= 2);
    let hour = seconds_of_day / 3_600;
    let minute = seconds_of_day % 3_600 / 60;
    let second = seconds_of_day % 60;
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}Z")
}

#[cfg(test)]
#[path = "sidebar_tests.rs"]
mod tests;
