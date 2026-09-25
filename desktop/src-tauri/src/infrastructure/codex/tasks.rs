use std::{path::PathBuf, time::Duration};

use serde::{Deserialize, Serialize};

use super::{
    connection::{AppServerConnection, ConnectionError},
    conversation_background::list_background_terminals,
    sidebar::unix_seconds_to_rfc3339,
};
use crate::domain::sidebar::{
    AgentTask, AgentTaskMutationResponse, AgentTaskPage, AgentTaskStatusResponse,
    ListCompletedTasksInput, ListTasksInput,
};

const PINNED_SECTION_ID: &str = "01984de2-8f74-7c91-a3b2-5c5e937cf318";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const TEMPORARY_PROJECT_ID: &str = "temporary";
const COMPLETED_TASK_DEFAULT_LIMIT: u32 = 10;
const COMPLETED_TASK_MAX_LIMIT: u32 = 100;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ThreadListParams<'a> {
    archived: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    cursor: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    limit: Option<u32>,
    model_providers: &'a [String],
    #[serde(skip_serializing_if = "Option::is_none")]
    project_id: Option<Option<&'a str>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    search_term: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    section_id: Option<Option<&'a str>>,
    sort_direction: &'static str,
    sort_key: &'static str,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeThreadPage {
    data: Vec<NativeThread>,
    next_cursor: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct NativeThread {
    #[serde(default)]
    cwd: Option<String>,
    pub(super) id: String,
    pub(super) model: Option<String>,
    pub(super) reasoning_effort: Option<String>,
    name: Option<String>,
    preview: String,
    pub(super) project_id: Option<String>,
    section: Option<NativeThreadSection>,
    status: NativeThreadStatus,
    updated_at: i64,
}

pub struct DeletedTask {
    pub response: AgentTaskStatusResponse,
    pub working_directory: Option<PathBuf>,
}

#[derive(Deserialize)]
struct NativeThreadSection {
    id: String,
}

#[derive(Deserialize)]
struct NativeThreadStatus {
    #[serde(rename = "type")]
    kind: String,
}

#[derive(Deserialize)]
struct NativeThreadResponse {
    thread: NativeThread,
}

#[derive(Deserialize)]
struct NativeThreadUnsubscribeResponse {
    status: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ThreadIdParams<'a> {
    thread_id: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ThreadReadParams<'a> {
    include_turns: bool,
    thread_id: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ThreadSetNameParams<'a> {
    name: &'a str,
    thread_id: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ThreadSectionMoveParams<'a> {
    section_id: Option<&'a str>,
    thread_id: &'a str,
}

pub async fn list_tasks(
    connection: &AppServerConnection,
    input: ListTasksInput,
) -> Result<AgentTaskPage, ConnectionError> {
    let project_filter = if input.project_id == TEMPORARY_PROJECT_ID {
        None
    } else {
        Some(input.project_id.as_str())
    };
    let response: NativeThreadPage = connection
        .request(
            "thread/list",
            &ThreadListParams {
                archived: input.archived.unwrap_or(false),
                cursor: input.cursor.as_deref(),
                limit: input.limit,
                // 空数组按 Codex 协议表示不过滤 Provider，切换 API 后历史仍可见。
                model_providers: &[],
                project_id: Some(project_filter),
                search_term: input.search_term.as_deref(),
                section_id: Some(input.pinned.unwrap_or(false).then_some(PINNED_SECTION_ID)),
                sort_direction: "desc",
                // TurnStarted 会单调推进 recency_at，精确表达用户最近激活的任务。
                sort_key: "recency_at",
            },
            REQUEST_TIMEOUT,
        )
        .await?;

    let mut data = Vec::with_capacity(response.data.len());
    for thread in response.data {
        if thread.project_id.as_deref() != project_filter {
            return Err(ConnectionError::InvalidMessage);
        }
        data.push(map_task(thread, &input.project_id));
    }
    Ok(AgentTaskPage {
        data,
        next_cursor: response.next_cursor,
    })
}

pub async fn list_completed_tasks(
    connection: &AppServerConnection,
    input: ListCompletedTasksInput,
) -> Result<AgentTaskPage, ConnectionError> {
    let limit = input
        .limit
        .unwrap_or(COMPLETED_TASK_DEFAULT_LIMIT)
        .clamp(1, COMPLETED_TASK_MAX_LIMIT) as usize;
    let selected_project_id = input.project_id.as_deref();
    let mut cursor = input.cursor;
    let mut requested_cursors = std::collections::HashSet::new();
    let mut data = Vec::with_capacity(limit);

    loop {
        let response: NativeThreadPage = connection
            .request(
                "thread/list",
                &ThreadListParams {
                    archived: false,
                    cursor: cursor.as_deref(),
                    limit: Some((limit - data.len()) as u32),
                    model_providers: &[],
                    project_id: selected_project_id.map(Some),
                    search_term: None,
                    section_id: None,
                    sort_direction: "desc",
                    sort_key: "updated_at",
                },
                REQUEST_TIMEOUT,
            )
            .await?;

        for thread in response.data {
            let Some(project_id) = thread.project_id.clone() else {
                continue;
            };
            if selected_project_id.is_some_and(|selected| selected != project_id) {
                return Err(ConnectionError::InvalidMessage);
            }
            // Codex 的 idle/notLoaded 都表示当前没有执行中的 Turn；失败任务单独排除。
            if !matches!(thread.status.kind.as_str(), "idle" | "notLoaded") {
                continue;
            }
            data.push(map_task(thread, &project_id));
            if data.len() == limit {
                return Ok(AgentTaskPage {
                    data,
                    next_cursor: response.next_cursor,
                });
            }
        }

        let Some(next_cursor) = response.next_cursor else {
            return Ok(AgentTaskPage {
                data,
                next_cursor: None,
            });
        };
        if !requested_cursors.insert(next_cursor.clone()) {
            return Err(ConnectionError::InvalidMessage);
        }
        cursor = Some(next_cursor);
    }
}

pub async fn read_task(
    connection: &AppServerConnection,
    project_id: String,
    task_id: String,
) -> Result<AgentTask, ConnectionError> {
    let thread = read_native_task(connection, &project_id, &task_id).await?;
    Ok(map_task(thread, &project_id))
}

pub async fn task_working_directory(
    connection: &AppServerConnection,
    project_id: &str,
    task_id: &str,
) -> Result<PathBuf, ConnectionError> {
    read_native_task(connection, project_id, task_id)
        .await?
        .cwd
        .filter(|cwd| !cwd.is_empty())
        .map(PathBuf::from)
        .ok_or(ConnectionError::InvalidMessage)
}

pub async fn rename_task(
    connection: &AppServerConnection,
    project_id: String,
    task_id: String,
    title: String,
) -> Result<AgentTaskMutationResponse, ConnectionError> {
    let title = title.trim();
    if title.is_empty() {
        return Err(ConnectionError::InvalidMessage);
    }
    let _title_mutation = connection.title_mutation.lock().await;
    read_native_task(connection, &project_id, &task_id).await?;
    request_empty(
        connection,
        "thread/name/set",
        &ThreadSetNameParams {
            name: title,
            thread_id: &task_id,
        },
    )
    .await?;
    Ok(AgentTaskMutationResponse {
        task: read_task(connection, project_id, task_id).await?,
    })
}

pub async fn pin_task(
    connection: &AppServerConnection,
    project_id: String,
    task_id: String,
    pinned: bool,
) -> Result<AgentTaskMutationResponse, ConnectionError> {
    read_native_task(connection, &project_id, &task_id).await?;
    request_empty(
        connection,
        "thread/section/move",
        &ThreadSectionMoveParams {
            section_id: pinned.then_some(PINNED_SECTION_ID),
            thread_id: &task_id,
        },
    )
    .await?;
    Ok(AgentTaskMutationResponse {
        task: read_task(connection, project_id, task_id).await?,
    })
}

pub async fn archive_task(
    connection: &AppServerConnection,
    project_id: String,
    task_id: String,
) -> Result<AgentTaskStatusResponse, ConnectionError> {
    read_native_task(connection, &project_id, &task_id).await?;
    request_empty(
        connection,
        "thread/archive",
        &ThreadIdParams {
            thread_id: &task_id,
        },
    )
    .await?;
    Ok(AgentTaskStatusResponse {
        status: "archived",
        task_id,
    })
}

pub async fn unarchive_task(
    connection: &AppServerConnection,
    project_id: String,
    task_id: String,
) -> Result<AgentTaskMutationResponse, ConnectionError> {
    read_native_task(connection, &project_id, &task_id).await?;
    let response: NativeThreadResponse = connection
        .request(
            "thread/unarchive",
            &ThreadIdParams {
                thread_id: &task_id,
            },
            REQUEST_TIMEOUT,
        )
        .await?;
    validate_task_project(&response.thread, &project_id)?;
    Ok(AgentTaskMutationResponse {
        task: map_task(response.thread, &project_id),
    })
}

pub async fn delete_task(
    connection: &AppServerConnection,
    project_id: String,
    task_id: String,
) -> Result<DeletedTask, ConnectionError> {
    let working_directory = read_native_task(connection, &project_id, &task_id)
        .await?
        .cwd
        .map(PathBuf::from);
    request_empty(
        connection,
        "thread/delete",
        &ThreadIdParams {
            thread_id: &task_id,
        },
    )
    .await?;
    super::task_title::take_task_title_root(connection, &task_id);
    Ok(DeletedTask {
        response: AgentTaskStatusResponse {
            status: "deleted",
            task_id,
        },
        working_directory,
    })
}

pub async fn unsubscribe_task(
    connection: &AppServerConnection,
    project_id: &str,
    task_id: &str,
) -> Result<AgentTaskStatusResponse, ConnectionError> {
    let thread = read_native_task(connection, project_id, task_id).await?;
    if thread.status.kind == "active"
        || !list_background_terminals(connection, task_id)
            .await?
            .data
            .is_empty()
    {
        return Ok(AgentTaskStatusResponse {
            status: "busy",
            task_id: task_id.to_owned(),
        });
    }
    if !matches!(
        thread.status.kind.as_str(),
        "idle" | "notLoaded" | "systemError"
    ) {
        return Err(ConnectionError::InvalidMessage);
    }
    connection
        .new_task_projects
        .lock()
        .map_err(|_| ConnectionError::StateUnavailable)?
        .remove(task_id);
    let response: NativeThreadUnsubscribeResponse = connection
        .request(
            "thread/unsubscribe",
            &ThreadIdParams { thread_id: task_id },
            REQUEST_TIMEOUT,
        )
        .await?;
    let status = match response.status.as_str() {
        "notLoaded" => "notLoaded",
        "notSubscribed" => "notSubscribed",
        "unsubscribed" => "unsubscribed",
        _ => return Err(ConnectionError::InvalidMessage),
    };
    Ok(AgentTaskStatusResponse {
        status,
        task_id: task_id.to_owned(),
    })
}

pub(super) async fn is_task_loaded(
    connection: &AppServerConnection,
    project_id: &str,
    task_id: &str,
) -> Result<bool, ConnectionError> {
    let thread = read_native_task(connection, project_id, task_id).await?;
    if thread.id != task_id {
        return Err(ConnectionError::InvalidMessage);
    }
    match thread.status.kind.as_str() {
        "idle" | "active" => Ok(true),
        "notLoaded" | "systemError" => Ok(false),
        _ => Err(ConnectionError::InvalidMessage),
    }
}

pub(super) async fn read_native_task(
    connection: &AppServerConnection,
    project_id: &str,
    task_id: &str,
) -> Result<NativeThread, ConnectionError> {
    let mut response: NativeThreadResponse = connection
        .request(
            "thread/read",
            &ThreadReadParams {
                include_turns: false,
                thread_id: task_id,
            },
            REQUEST_TIMEOUT,
        )
        .await?;
    connection.restore_new_task_project(&response.thread.id, &mut response.thread.project_id)?;
    validate_task_project(&response.thread, project_id)?;
    Ok(response.thread)
}

pub(super) fn validate_task_project(
    thread: &NativeThread,
    project_id: &str,
) -> Result<(), ConnectionError> {
    let expected = (project_id != TEMPORARY_PROJECT_ID).then_some(project_id);
    if thread.project_id.as_deref() != expected {
        return Err(ConnectionError::InvalidMessage);
    }
    Ok(())
}

async fn request_empty<P: Serialize>(
    connection: &AppServerConnection,
    method: &str,
    params: &P,
) -> Result<(), ConnectionError> {
    let _: serde_json::Value = connection.request(method, params, REQUEST_TIMEOUT).await?;
    Ok(())
}

pub(super) fn map_task(thread: NativeThread, project_id: &str) -> AgentTask {
    let title = thread
        .name
        .as_deref()
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .or_else(|| {
            thread
                .preview
                .lines()
                .next()
                .map(str::trim)
                .filter(|preview| !preview.is_empty())
        })
        .unwrap_or("新聊天")
        .to_owned();
    AgentTask {
        id: thread.id,
        pinned: thread
            .section
            .is_some_and(|section| section.id == PINNED_SECTION_ID),
        project_id: project_id.to_owned(),
        title,
        updated_at: unix_seconds_to_rfc3339(thread.updated_at),
    }
}

#[cfg(test)]
#[path = "tasks_tests.rs"]
mod tests;
