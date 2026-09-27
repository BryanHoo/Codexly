use super::{
    connection::{AppServerConnection, ConnectionError},
    tasks::{NativeThread, map_task},
};
use crate::domain::search::{
    SearchOccurrencesPage, TaskSearchInput, TaskSearchPage, TaskSearchResult,
};
use futures_util::{StreamExt, TryStreamExt, stream};
use serde::Deserialize;
use serde_json::json;
use std::time::Duration;

const SEARCH_PAGE_SIZE: usize = 30;
const HISTORY_PAGE_SIZE: usize = 10;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeSearchPage<T> {
    data: Vec<T>,
    next_cursor: Option<String>,
}
#[derive(Deserialize)]
struct NativeSearchResult {
    thread: NativeThread,
    snippet: String,
}

fn validate_query(query: &str) -> Result<&str, ConnectionError> {
    let query = query.trim();
    if query.is_empty() || query.chars().count() > 1024 {
        return Err(ConnectionError::InvalidMessage);
    }
    Ok(query)
}

pub async fn search_tasks(
    connection: &AppServerConnection,
    input: TaskSearchInput,
) -> Result<TaskSearchPage, ConnectionError> {
    let query = validate_query(&input.query)?;
    let kind = input.kind.as_deref().unwrap_or("history");
    let is_history = kind == "history";
    // 历史结果需逐条验证定位锚点，小页降低单次搜索的 RPC 数与尾延迟。
    let page_size = if is_history {
        HISTORY_PAGE_SIZE
    } else {
        SEARCH_PAGE_SIZE
    };
    let mut params = json!({"searchTerm":query,"archived":input.archived,"cursor":input.cursor,"limit":page_size,"sortKey":"recency_at","sortDirection":"desc"});
    let (results, next_cursor) = match kind {
        "tasks" => {
            // 不指定 projectId/sectionId，包含临时、固定以及全部项目的任务标题。
            params["modelProviders"] = json!([]);
            let page: NativeSearchPage<NativeThread> = connection
                .request("thread/list", &params, REQUEST_TIMEOUT)
                .await?;
            (
                page.data
                    .into_iter()
                    .map(|thread| NativeSearchResult {
                        thread,
                        snippet: String::new(),
                    })
                    .collect::<Vec<_>>(),
                page.next_cursor,
            )
        }
        "history" => {
            // 由官方服务端搜索持久化可见消息，禁止在 WebView 拉取全部历史自行匹配。
            let page: NativeSearchPage<NativeSearchResult> = connection
                .request("thread/search", &params, REQUEST_TIMEOUT)
                .await?;
            (page.data, page.next_cursor)
        }
        _ => return Err(ConnectionError::InvalidMessage),
    };
    // rollout 搜索包含过程答复；只有当前可见历史确实有锚点才展示，最多并发 4 次轻量查询。
    let data = stream::iter(results.into_iter().take(page_size))
        .map(|result| async move {
            let occurrence = if is_history {
                let page: SearchOccurrencesPage = connection
                    .request(
                        "thread/searchOccurrences",
                        &json!({"threadId":result.thread.id,"searchTerm":query,"limit":1}),
                        REQUEST_TIMEOUT,
                    )
                    .await?;
                let Some(first) = page.data.into_iter().next() else {
                    return Ok(None);
                };
                Some(first)
            } else {
                None
            };
            let project_id = result
                .thread
                .project_id
                .clone()
                .unwrap_or_else(|| "temporary".into());
            Ok::<_, ConnectionError>(Some(TaskSearchResult {
                task: map_task(result.thread, &project_id),
                snippet: occurrence.as_ref().map_or_else(
                    || result.snippet.chars().take(2048).collect(),
                    |hit| hit.snippet.clone(),
                ),
                occurrence,
            }))
        })
        .buffered(4)
        .try_collect::<Vec<_>>()
        .await?
        .into_iter()
        .flatten()
        .collect();
    Ok(TaskSearchPage { data, next_cursor })
}

pub async fn search_task_occurrences(
    connection: &AppServerConnection,
    task_id: &str,
    query: &str,
    cursor: Option<&str>,
) -> Result<SearchOccurrencesPage, ConnectionError> {
    let query = validate_query(query)?;
    let page = connection.request("thread/searchOccurrences", &json!({"threadId":task_id,"searchTerm":query,"cursor":cursor,"limit":SEARCH_PAGE_SIZE}), REQUEST_TIMEOUT).await?;
    Ok(page)
}

#[cfg(test)]
#[path = "search_tests.rs"]
mod tests;
