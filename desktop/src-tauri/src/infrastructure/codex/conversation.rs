use std::{collections::BTreeMap, time::Duration};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::conversation_advanced::get_goal;
pub(super) use super::conversation_items::map_item;
use super::conversation_items::map_status;
use super::{connection::ConnectionError, sidebar::unix_seconds_to_rfc3339};
use crate::domain::conversation::{
    AgentItemTiming, AgentTaskSettings, AgentTaskSnapshot, AgentTaskSnapshotResponse,
    AgentThreadConfiguration, AgentTurn, EventCheckpoint,
};

use super::AppServerConnection;

pub(super) const PINNED_SECTION_ID: &str = "01984de2-8f74-7c91-a3b2-5c5e937cf318";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const TURN_PAGE_LIMIT: u32 = 10;
const ITEM_PAGE_LIMIT: u32 = 100;
#[path = "conversation_item_pagination.rs"]
mod item_pagination;
#[cfg(test)]
use item_pagination::hydrate_paginated_turn;
use item_pagination::{read_summary_turn_page, read_turn_page};
#[cfg(test)]
#[path = "conversation_preview_tests.rs"]
mod preview_tests;
pub(crate) const RUNTIME_SESSION_ID: &str = "codeagent-runtime";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ThreadReadParams<'a> {
    include_turns: bool,
    thread_id: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ThreadTurnsListParams<'a> {
    cursor: Option<&'a str>,
    items_view: &'static str,
    limit: u32,
    sort_direction: &'static str,
    thread_id: &'a str,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ThreadTurnsListResponse {
    backwards_cursor: Option<String>,
    data: Vec<NativeTurn>,
    next_cursor: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ThreadItemsListParams<'a> {
    cursor: Option<&'a str>,
    limit: u32,
    sort_direction: &'static str,
    thread_id: &'a str,
    turn_id: &'a str,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ThreadItemsListResponse {
    backwards_cursor: Option<String>,
    data: Vec<NativeThreadItemEntry>,
    next_cursor: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeThreadItemEntry {
    completed_at_ms: Option<i64>,
    item: Value,
    started_at_ms: Option<i64>,
    turn_id: String,
}

#[derive(Deserialize)]
struct NativeThreadResponse {
    thread: NativeThread,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeThread {
    cwd: Option<String>,
    model: Option<String>,
    reasoning_effort: Option<String>,
    history_mode: NativeThreadHistoryMode,
    id: String,
    name: Option<String>,
    preview: String,
    project_id: Option<String>,
    section: Option<NativeThreadSection>,
    status: NativeThreadStatus,
    updated_at: i64,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
enum NativeThreadHistoryMode {
    Legacy,
    Paginated,
}

#[derive(Deserialize)]
pub(super) struct NativeThreadSection {
    pub(super) id: String,
}

#[derive(Deserialize)]
struct NativeThreadStatus {
    #[serde(rename = "type")]
    kind: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct NativeTurn {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    process_cursor: Option<String>,
    completed_at: Option<i64>,
    error: Option<NativeTurnError>,
    id: String,
    #[serde(skip)]
    item_timings: Option<BTreeMap<String, AgentItemTiming>>,
    #[serde(default, skip_serializing)]
    items: Vec<Value>,
    started_at: Option<i64>,
    status: String,
}

#[derive(Deserialize, Serialize)]
struct NativeTurnError {
    message: String,
}

pub async fn read_task_snapshot(
    connection: &AppServerConnection,
    project_id: String,
    task_id: String,
    cursor: Option<&str>,
) -> Result<AgentTaskSnapshotResponse, ConnectionError> {
    read_task_snapshot_view(connection, project_id, task_id, cursor, false).await
}

pub async fn read_task_summary_snapshot(
    connection: &AppServerConnection,
    project_id: String,
    task_id: String,
    cursor: Option<&str>,
) -> Result<AgentTaskSnapshotResponse, ConnectionError> {
    read_task_snapshot_view(connection, project_id, task_id, cursor, true).await
}

async fn read_task_snapshot_view(
    connection: &AppServerConnection,
    project_id: String,
    task_id: String,
    cursor: Option<&str>,
    summary: bool,
) -> Result<AgentTaskSnapshotResponse, ConnectionError> {
    if let Some(catalog) = &connection.catalog {
        catalog.owned_task(&project_id, &task_id).await?;
    }
    let response: NativeThreadResponse = connection
        .request(
            "thread/read",
            &ThreadReadParams {
                include_turns: false,
                thread_id: &task_id,
            },
            REQUEST_TIMEOUT,
        )
        .await?;
    let thread = response.thread;
    validate_thread(&thread, &project_id, &task_id)?;

    let (native_turns, next_cursor) = if summary {
        read_summary_turn_page(connection, &task_id, thread.history_mode, cursor).await?
    } else {
        read_turn_page(connection, &task_id, thread.history_mode, cursor).await?
    };
    // app-server 倒序分页以最新回合优先返回，UI 时间线保持正序展示。
    let turns = native_turns
        .into_iter()
        .rev()
        .map(map_turn)
        .collect::<Result<Vec<_>, _>>()?;
    let status = if turns.iter().any(|turn| turn.status == "running") {
        "running"
    } else {
        map_thread_status(&thread.status)?
    };
    let goal = get_goal(connection, &task_id).await?;

    Ok(AgentTaskSnapshotResponse {
        checkpoint: EventCheckpoint {
            sequence: 0,
            session_id: RUNTIME_SESSION_ID,
        },
        snapshot: AgentTaskSnapshot {
            engine: None,
            workspace_path: thread.cwd,
            context_usage: None,
            goal,
            id: thread.id,
            pending_requests: Vec::new(),
            pinned: thread
                .section
                .is_some_and(|section| section.id == PINNED_SECTION_ID),
            plan: None,
            project_id,
            settings: AgentTaskSettings::default(),
            thread_configuration: AgentThreadConfiguration {
                model: thread.model,
                reasoning_effort: thread.reasoning_effort,
            },
            status,
            title: normalized_title(thread.name.as_deref(), &thread.preview),
            turns,
            turns_next_cursor: next_cursor,
            updated_at: unix_seconds_to_rfc3339(thread.updated_at),
        },
    })
}

/// 小窗只读取最近回合的一页，禁止沿游标展开历史或读取 Goal 等无关状态。
pub async fn read_task_preview(
    connection: &AppServerConnection,
    project_id: &str,
    task_id: &str,
) -> Result<
    (
        String,
        &'static str,
        Vec<crate::domain::conversation::AgentItem>,
    ),
    ConnectionError,
> {
    if let Some(catalog) = &connection.catalog {
        catalog.owned_task(project_id, task_id).await?;
    }
    let response: NativeThreadResponse = connection
        .request(
            "thread/read",
            &ThreadReadParams {
                include_turns: false,
                thread_id: task_id,
            },
            REQUEST_TIMEOUT,
        )
        .await?;
    let thread = response.thread;
    validate_thread(&thread, project_id, task_id)?;
    let page: ThreadTurnsListResponse = connection
        .request(
            "thread/turns/list",
            &ThreadTurnsListParams {
                cursor: None,
                items_view: "notLoaded",
                limit: 1,
                sort_direction: "desc",
                thread_id: task_id,
            },
            REQUEST_TIMEOUT,
        )
        .await?;
    let mut items = Vec::new();
    if let Some(turn) = page.data.into_iter().next() {
        let page: ThreadItemsListResponse = connection
            .request(
                "thread/items/list",
                &ThreadItemsListParams {
                    cursor: None,
                    limit: 12,
                    sort_direction: "desc",
                    thread_id: task_id,
                    turn_id: &turn.id,
                },
                REQUEST_TIMEOUT,
            )
            .await?;
        for entry in page.data.into_iter().take(12).rev() {
            if entry.turn_id != turn.id {
                return Err(ConnectionError::InvalidMessage);
            }
            items.push(map_item(entry.item)?);
        }
    }
    Ok((
        normalized_title(thread.name.as_deref(), &thread.preview),
        map_thread_status(&thread.status)?,
        items,
    ))
}

fn validate_page_cursors(
    current: Option<&str>,
    next: Option<&str>,
    backwards: Option<&str>,
) -> Result<(), ConnectionError> {
    if next.is_some_and(|value| value.is_empty() || Some(value) == current)
        || backwards.is_some_and(str::is_empty)
    {
        return Err(ConnectionError::InvalidMessage);
    }
    Ok(())
}

fn validate_thread(
    thread: &NativeThread,
    project_id: &str,
    task_id: &str,
) -> Result<(), ConnectionError> {
    let expected_project = (project_id != "temporary").then_some(project_id);
    if thread.id != task_id || thread.project_id.as_deref() != expected_project {
        return Err(ConnectionError::InvalidMessage);
    }
    Ok(())
}

pub(super) fn normalized_title(name: Option<&str>, preview: &str) -> String {
    name.map(str::trim)
        .filter(|value| !value.is_empty())
        .or_else(|| {
            preview
                .lines()
                .next()
                .map(str::trim)
                .filter(|value| !value.is_empty())
        })
        .unwrap_or("新聊天")
        .to_owned()
}

fn map_thread_status(status: &NativeThreadStatus) -> Result<&'static str, ConnectionError> {
    match status.kind.as_str() {
        "active" => Ok("running"),
        "systemError" => Ok("failed"),
        "idle" | "notLoaded" => Ok("idle"),
        _ => Err(ConnectionError::InvalidMessage),
    }
}

pub(super) fn map_turn(turn: NativeTurn) -> Result<AgentTurn, ConnectionError> {
    let status = map_status(&turn.status, true)?;
    let mut items = turn
        .items
        .into_iter()
        .map(super::conversation_items::map_item_without_skill_normalization)
        .collect::<Result<Vec<_>, _>>()?;
    crate::domain::conversation_skills::normalize_turn_skills(&mut items);
    Ok(AgentTurn {
        process_cursor: turn.process_cursor,
        completed_at: turn.completed_at.map(unix_seconds_to_rfc3339),
        error: turn.error.map(|error| error.message),
        id: turn.id,
        item_timings: turn.item_timings,
        items,
        started_at: turn.started_at.map(unix_seconds_to_rfc3339),
        status,
    })
}

#[cfg(test)]
#[path = "conversation_pagination_tests.rs"]
mod pagination_tests;
