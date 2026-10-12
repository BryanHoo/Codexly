use super::{AppServerConnection, ConnectionError, REQUEST_TIMEOUT};
use crate::domain::search::{SearchOccurrence, SearchOccurrencesPage, SearchTextRange};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::HashSet;

const PREFIX: &str = "codexly-search-v1:";

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SearchCursor {
    thread_id: String,
    query: String,
    turn_cursor: Option<String>,
    offset: usize,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TurnPage {
    data: Vec<SearchTurn>,
    backwards_cursor: Option<String>,
    next_cursor: Option<String>,
}

#[derive(Deserialize)]
struct SearchTurn {
    id: String,
    items: Vec<Value>,
}

pub(super) fn is_legacy_cursor(cursor: Option<&str>) -> bool {
    cursor.is_some_and(|cursor| cursor.starts_with(PREFIX))
}

fn decode_cursor(
    cursor: Option<&str>,
    thread_id: &str,
    query: &str,
) -> Result<SearchCursor, ConnectionError> {
    let Some(cursor) = cursor else {
        return Ok(SearchCursor {
            thread_id: thread_id.into(),
            query: query.into(),
            turn_cursor: None,
            offset: 0,
        });
    };
    let raw = cursor
        .strip_prefix(PREFIX)
        .filter(|_| cursor.len() <= 8192)
        .ok_or(ConnectionError::InvalidMessage)?;
    let state: SearchCursor =
        serde_json::from_str(raw).map_err(|_| ConnectionError::InvalidMessage)?;
    if state.thread_id != thread_id || state.query != query {
        return Err(ConnectionError::InvalidMessage);
    }
    Ok(state)
}

fn encode_cursor(state: &SearchCursor) -> Result<String, ConnectionError> {
    Ok(format!("{PREFIX}{}", serde_json::to_string(state)?))
}

fn visible_text(item: &Value) -> Option<String> {
    match item["type"].as_str()? {
        "agentMessage" if item["phase"].as_str() != Some("commentary") => {
            item["text"].as_str().map(str::to_owned)
        }
        "userMessage" => Some(
            item["content"]
                .as_array()?
                .iter()
                .filter(|part| part["type"] == "text")
                .filter_map(|part| part["text"].as_str())
                .collect::<String>(),
        ),
        _ => None,
    }
}

fn occurrence(
    text: &str,
    range: std::ops::Range<usize>,
    item_id: &str,
    turn_id: &str,
    anchor: &str,
) -> SearchOccurrence {
    let before = text[..range.start]
        .chars()
        .rev()
        .take(48)
        .map(char::len_utf8)
        .sum::<usize>();
    let after = text[range.end..]
        .chars()
        .take(96)
        .map(char::len_utf8)
        .sum::<usize>();
    let start = range.start - before;
    let end = range.end + after;
    let prefix = if start > 0 { "…" } else { "" };
    let snippet = format!(
        "{prefix}{}{}",
        &text[start..end],
        if end < text.len() { "…" } else { "" }
    );
    let match_start =
        prefix.encode_utf16().count() + text[start..range.start].encode_utf16().count();
    SearchOccurrence {
        item_id: item_id.into(),
        turn_id: turn_id.into(),
        turn_cursor: anchor.into(),
        snippet,
        snippet_match_range: SearchTextRange {
            start: match_start as u32,
            end: (match_start + text[range].encode_utf16().count()) as u32,
        },
    }
}

pub(super) async fn search_occurrences(
    connection: &AppServerConnection,
    thread_id: &str,
    query: &str,
    cursor: Option<&str>,
    limit: usize,
) -> Result<SearchOccurrencesPage, ConnectionError> {
    let mut state = decode_cursor(cursor, thread_id, query)?;
    let needle = query.to_lowercase();
    let mut visited = HashSet::new();
    loop {
        if !visited.insert(state.turn_cursor.clone()) {
            return Err(ConnectionError::InvalidMessage);
        }
        // 与 Web 后端采用同一兼容游标；只逐页读取十个回合，不向前端传输整段历史。
        let page: TurnPage = connection
            .request(
                "thread/turns/list",
                &json!({
                    "threadId": thread_id, "cursor": state.turn_cursor,
                    "itemsView": "full", "limit": 10, "sortDirection": "desc",
                }),
                REQUEST_TIMEOUT,
            )
            .await?;
        if page.data.len() > 10
            || page
                .next_cursor
                .as_ref()
                .is_some_and(|next| visited.contains(&Some(next.clone())))
        {
            return Err(ConnectionError::InvalidMessage);
        }
        let mut data = Vec::with_capacity(limit);
        let mut offset = 0;
        for turn in page.data {
            for item in turn.items {
                let Some(text) = visible_text(&item) else {
                    continue;
                };
                // Unicode 小写可能扩展字节数，映射回原文字节边界后再计算 UTF-16 高亮范围。
                let folded = text.to_lowercase();
                let mut characters = text.char_indices();
                let mut folded_end = 0;
                let mut original = 0..0;
                // 双指针按需换算命中边界，不为消息的每个字符分配映射表。
                let mut locate = |position| {
                    while folded_end <= position {
                        let (start, character) = characters.next()?;
                        folded_end += character.to_lowercase().map(char::len_utf8).sum::<usize>();
                        original = start..start + character.len_utf8();
                    }
                    Some(original.clone())
                };
                for (start, matched) in folded.match_indices(&needle) {
                    let index = offset;
                    offset += 1;
                    if index < state.offset {
                        continue;
                    }
                    let anchor = page
                        .backwards_cursor
                        .as_deref()
                        .filter(|anchor| !anchor.is_empty())
                        .ok_or(ConnectionError::InvalidMessage)?;
                    if data.len() == limit {
                        state.turn_cursor = Some(anchor.into());
                        state.offset = index;
                        return Ok(SearchOccurrencesPage {
                            data,
                            next_cursor: Some(encode_cursor(&state)?),
                        });
                    }
                    let original_start =
                        locate(start).ok_or(ConnectionError::InvalidMessage)?.start;
                    let original_end = locate(start + matched.len() - 1)
                        .ok_or(ConnectionError::InvalidMessage)?
                        .end;
                    let range = original_start..original_end;
                    let item_id = item["id"].as_str().ok_or(ConnectionError::InvalidMessage)?;
                    // 页的 inclusive 锚点包含这十个回合，定位视图可按稳定消息 ID 精确跳转。
                    data.push(occurrence(&text, range, item_id, &turn.id, anchor));
                }
            }
        }
        state.turn_cursor = page.next_cursor;
        state.offset = 0;
        if !data.is_empty() || state.turn_cursor.is_none() {
            let next_cursor = state
                .turn_cursor
                .as_ref()
                .map(|_| encode_cursor(&state))
                .transpose()?;
            return Ok(SearchOccurrencesPage { data, next_cursor });
        }
    }
}
