use std::collections::{BTreeMap, HashSet};

use futures_util::future::try_join_all;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::{
    AppServerConnection, ConnectionError, ITEM_PAGE_LIMIT, NativeThreadHistoryMode, NativeTurn,
    REQUEST_TIMEOUT, TURN_PAGE_LIMIT, ThreadItemsListParams, ThreadItemsListResponse,
    ThreadTurnsListParams, ThreadTurnsListResponse, validate_page_cursors,
};
use crate::domain::conversation::AgentItemTiming;

const CURSOR_PREFIX: &str = "codexly-items-v1:";
const MAX_CURSOR_BYTES: usize = 8_192;

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ItemContinuation {
    next_turn_cursor: Option<String>,
    pending: Vec<PendingTurnItems>,
    thread_id: String,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct PendingTurnItems {
    cursor: String,
    turn: NativeTurn,
}

/// 游标携带尚未读完的回合与 Item 位置，优先续读这些回合，再推进 Turn 页。
pub(super) async fn read_turn_page(
    connection: &AppServerConnection,
    thread_id: &str,
    mode: NativeThreadHistoryMode,
    cursor: Option<&str>,
) -> Result<(Vec<NativeTurn>, Option<String>), ConnectionError> {
    if let Some(value) = cursor.and_then(|value| value.strip_prefix(CURSOR_PREFIX)) {
        if value.len() + CURSOR_PREFIX.len() > MAX_CURSOR_BYTES
            || !matches!(mode, NativeThreadHistoryMode::Paginated)
        {
            return Err(ConnectionError::InvalidMessage);
        }
        let continuation: ItemContinuation =
            serde_json::from_str(value).map_err(|_| ConnectionError::InvalidMessage)?;
        let mut ids = HashSet::new();
        if continuation.thread_id != thread_id
            || continuation.pending.is_empty()
            || continuation.pending.len() > TURN_PAGE_LIMIT as usize
            || continuation
                .next_turn_cursor
                .as_deref()
                .is_some_and(|value| value.is_empty() || value.starts_with(CURSOR_PREFIX))
            || continuation.pending.iter().any(|entry| {
                entry.cursor.is_empty() || entry.turn.id.is_empty() || !ids.insert(&entry.turn.id)
            })
        {
            return Err(ConnectionError::InvalidMessage);
        }
        return hydrate_turn_page(
            connection,
            thread_id,
            continuation
                .pending
                .into_iter()
                .map(|entry| (entry.turn, Some(entry.cursor)))
                .collect(),
            continuation.next_turn_cursor,
        )
        .await;
    }
    let page: ThreadTurnsListResponse = connection
        .request(
            "thread/turns/list",
            &ThreadTurnsListParams {
                cursor,
                items_view: match mode {
                    NativeThreadHistoryMode::Legacy => "full",
                    NativeThreadHistoryMode::Paginated => "notLoaded",
                },
                limit: TURN_PAGE_LIMIT,
                sort_direction: "desc",
                thread_id,
            },
            REQUEST_TIMEOUT,
        )
        .await?;
    validate_page_cursors(
        cursor,
        page.next_cursor.as_deref(),
        page.backwards_cursor.as_deref(),
    )?;
    if page.data.len() > TURN_PAGE_LIMIT as usize {
        return Err(ConnectionError::InvalidMessage);
    }
    match mode {
        NativeThreadHistoryMode::Legacy => Ok((page.data, page.next_cursor)),
        NativeThreadHistoryMode::Paginated => {
            hydrate_turn_page(
                connection,
                thread_id,
                page.data.into_iter().map(|turn| (turn, None)).collect(),
                page.next_cursor,
            )
            .await
        }
    }
}

async fn hydrate_turn_page(
    connection: &AppServerConnection,
    thread_id: &str,
    turns: Vec<(NativeTurn, Option<String>)>,
    next_turn_cursor: Option<String>,
) -> Result<(Vec<NativeTurn>, Option<String>), ConnectionError> {
    // 并发数受 Turn 页上限约束；每个回合只请求一页，绝不在返回快照前追读。
    let pages = try_join_all(turns.into_iter().map(|(turn, cursor)| async move {
        hydrate_paginated_turn_page(connection, thread_id, turn, cursor.as_deref()).await
    }))
    .await?;
    let pending = pages
        .iter()
        .filter_map(|(turn, cursor)| {
            cursor.as_ref().map(|cursor| PendingTurnItems {
                cursor: cursor.clone(),
                // 保留最小回合元数据，避免 Item 或错误正文随游标重复传输。
                turn: NativeTurn {
                    id: turn.id.clone(),
                    status: turn.status.clone(),
                    started_at: turn.started_at,
                    completed_at: turn.completed_at,
                    error: None,
                    items: Vec::new(),
                    item_timings: None,
                },
            })
        })
        .collect::<Vec<_>>();
    let next_cursor = if pending.is_empty() {
        next_turn_cursor
    } else {
        let encoded = serde_json::to_string(&ItemContinuation {
            thread_id: thread_id.to_owned(),
            next_turn_cursor,
            pending,
        })
        .map_err(|_| ConnectionError::InvalidMessage)?;
        if encoded.len() + CURSOR_PREFIX.len() > MAX_CURSOR_BYTES {
            return Err(ConnectionError::InvalidMessage);
        }
        Some(format!("{CURSOR_PREFIX}{encoded}"))
    };
    Ok((
        pages.into_iter().map(|(turn, _)| turn).collect(),
        next_cursor,
    ))
}

#[cfg(test)]
pub(super) async fn hydrate_paginated_turn(
    connection: &AppServerConnection,
    thread_id: &str,
    turn: NativeTurn,
) -> Result<(NativeTurn, Option<String>), ConnectionError> {
    hydrate_paginated_turn_page(connection, thread_id, turn, None).await
}

async fn hydrate_paginated_turn_page(
    connection: &AppServerConnection,
    thread_id: &str,
    mut turn: NativeTurn,
    cursor: Option<&str>,
) -> Result<(NativeTurn, Option<String>), ConnectionError> {
    let page: ThreadItemsListResponse = connection
        .request(
            "thread/items/list",
            &ThreadItemsListParams {
                cursor,
                limit: ITEM_PAGE_LIMIT,
                sort_direction: "desc",
                thread_id,
                turn_id: &turn.id,
            },
            REQUEST_TIMEOUT,
        )
        .await?;
    validate_page_cursors(
        cursor,
        page.next_cursor.as_deref(),
        page.backwards_cursor.as_deref(),
    )?;
    if page.data.len() > ITEM_PAGE_LIMIT as usize {
        return Err(ConnectionError::InvalidMessage);
    }
    let mut items = Vec::with_capacity(page.data.len());
    let mut item_timings = BTreeMap::new();
    for entry in page.data {
        if entry.turn_id != turn.id
            || entry.started_at_ms.is_some_and(|value| value < 0)
            || entry.completed_at_ms.is_some_and(|value| value < 0)
        {
            return Err(ConnectionError::InvalidMessage);
        }
        if entry.started_at_ms.is_some() || entry.completed_at_ms.is_some() {
            let id = entry
                .item
                .get("id")
                .and_then(Value::as_str)
                .ok_or(ConnectionError::InvalidMessage)?;
            item_timings.insert(
                id.to_owned(),
                AgentItemTiming {
                    completed_at_ms: entry.completed_at_ms,
                    started_at_ms: entry.started_at_ms,
                },
            );
        }
        items.push(entry.item);
    }
    items.reverse();
    turn.items = items;
    turn.item_timings = (!item_timings.is_empty()).then_some(item_timings);
    Ok((turn, page.next_cursor))
}
