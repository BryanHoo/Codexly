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
/// 进程内只初始化一次，所有引擎、快照和事件共用；重启后拒绝旧进程的序号与实体。
pub(crate) fn runtime_session_id() -> &'static str {
    static SESSION: std::sync::LazyLock<String> =
        std::sync::LazyLock::new(|| uuid::Uuid::new_v4().to_string());
    SESSION.as_str()
}

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

    let (native_page, prefetched_goal) = if summary {
        // 正文摘要与 Goal 互不依赖；优先发出历史请求，并行等待，减少首次打开的串行往返。
        let (page, goal) = tokio::try_join!(
            biased;
            read_summary_turn_page(connection, &task_id, thread.history_mode, cursor),
            get_goal(connection, &task_id),
        )?;
        (page, Some(goal))
    } else {
        (
            read_turn_page(connection, &task_id, thread.history_mode, cursor).await?,
            None,
        )
    };
    let (native_turns, next_cursor) = native_page;
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
    let goal = match prefetched_goal {
        Some(goal) => goal,
        None => get_goal(connection, &task_id).await?,
    };

    Ok(AgentTaskSnapshotResponse {
        checkpoint: EventCheckpoint {
            sequence: 0,
            session_id: runtime_session_id(),
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

pub(super) fn map_turn(mut turn: NativeTurn) -> Result<AgentTurn, ConnectionError> {
    let status = map_status(&turn.status, true)?;
    // 0.166 的历史和实时 Turn 共用条目时间；新值按字段优先，null/缺失保留旧分页计时。
    // 仅检查当前已加载条目，借用正文，避免为恢复耗时额外加载或复制整段历史。
    for item in &turn.items {
        let read_timestamp = |key: &str| match item.get(key) {
            None | Some(Value::Null) => Ok(None),
            Some(value) => value
                .as_i64()
                // IPC 进入 JavaScript 后仍须保持毫秒整数精度，与 Web 适配器边界一致。
                .filter(|value| (0..=9_007_199_254_740_991).contains(value))
                .map(Some)
                .ok_or(ConnectionError::InvalidMessage),
        };
        let started_at_ms = read_timestamp("startedAtMs")?;
        let completed_at_ms = read_timestamp("completedAtMs")?;
        if started_at_ms.is_none() && completed_at_ms.is_none() {
            continue;
        }
        let id = item
            .get("id")
            .and_then(Value::as_str)
            .ok_or(ConnectionError::InvalidMessage)?;
        let timing = turn
            .item_timings
            .get_or_insert_with(BTreeMap::new)
            .entry(id.to_owned())
            .or_insert(AgentItemTiming {
                started_at_ms: None,
                completed_at_ms: None,
            });
        timing.started_at_ms = started_at_ms.or(timing.started_at_ms);
        timing.completed_at_ms = completed_at_ms.or(timing.completed_at_ms);
    }
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

#[cfg(test)]
#[path = "codex_166_contract_tests.rs"]
mod codex_166_contract_tests;

#[cfg(test)]
#[path = "runtime_session_tests.rs"]
mod runtime_session_tests;
