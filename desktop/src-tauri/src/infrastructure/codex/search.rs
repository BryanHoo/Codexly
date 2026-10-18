use super::connection::{AppServerConnection, ConnectionError};
use crate::domain::search::SearchOccurrencesPage;
use serde_json::json;
use std::time::Duration;

const SEARCH_PAGE_SIZE: usize = 30;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

#[path = "search_legacy.rs"]
mod legacy;

fn validate_query(query: &str) -> Result<&str, ConnectionError> {
    let query = query.trim();
    if query.is_empty() || query.chars().count() > 1024 {
        return Err(ConnectionError::InvalidMessage);
    }
    Ok(query)
}

pub async fn search_task_occurrences(
    connection: &AppServerConnection,
    task_id: &str,
    query: &str,
    cursor: Option<&str>,
) -> Result<SearchOccurrencesPage, ConnectionError> {
    search_task_occurrences_with_limit(connection, task_id, query, cursor, SEARCH_PAGE_SIZE).await
}

pub async fn search_task_occurrences_with_limit(
    connection: &AppServerConnection,
    task_id: &str,
    query: &str,
    cursor: Option<&str>,
    limit: usize,
) -> Result<SearchOccurrencesPage, ConnectionError> {
    let query = validate_query(query)?;
    request_occurrences(connection, task_id, query, cursor, limit).await
}

async fn request_occurrences(
    connection: &AppServerConnection,
    task_id: &str,
    query: &str,
    cursor: Option<&str>,
    limit: usize,
) -> Result<SearchOccurrencesPage, ConnectionError> {
    if legacy::is_legacy_cursor(cursor) {
        return legacy::search_occurrences(connection, task_id, query, cursor, limit).await;
    }
    match connection
        .request(
            "thread/searchOccurrences",
            &json!({"threadId":task_id,"searchTerm":query,"cursor":cursor,"limit":limit}),
            REQUEST_TIMEOUT,
        )
        .await
    {
        // 只兼容旧 rollout 的方法缺失，其他错误保持原有语义，不能伪装成无匹配。
        Err(ConnectionError::Request { code: -32601, .. }) => {
            legacy::search_occurrences(connection, task_id, query, cursor, limit).await
        }
        result => result,
    }
}

#[cfg(test)]
#[path = "search_tests.rs"]
mod tests;
