use std::{collections::HashSet, time::Duration};

use serde::Deserialize;
use serde_json::json;

use super::{
    AppServerConnection, connection::ConnectionError,
    conversation_queue::reorder_queued_submissions,
};

const PAGE_LIMIT: usize = 100;
const MAX_PAGES: usize = 100;
const MAX_ID_BYTES: usize = 256 * 1024;
const MAX_FIELD_BYTES: usize = 4096;
const TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct QueueIdPage {
    data: Vec<QueueId>,
    next_cursor: Option<String>,
}

#[derive(Deserialize)]
struct QueueId {
    id: String,
}

pub async fn move_queued_submission(
    connection: &AppServerConnection,
    task_id: &str,
    submission_id: &str,
    offset: i8,
) -> Result<bool, ConnectionError> {
    if !matches!(offset, -1 | 1)
        || submission_id.is_empty()
        || submission_id.len() > MAX_FIELD_BYTES
    {
        return Err(ConnectionError::InvalidMessage);
    }
    // 整次读取和重排共用超时，不因分页数量放大等待时间。
    tokio::time::timeout(TIMEOUT, async {
        let mut ids = read_queue_ids(connection, task_id).await?;
        let Some(index) = ids.iter().position(|id| id == submission_id) else {
            return Ok(false);
        };
        let Some(target) = index
            .checked_add_signed(isize::from(offset))
            .filter(|target| *target < ids.len())
        else {
            return Ok(false);
        };
        ids.swap(index, target);
        // Codex 原子校验完整 ID 集合；读后发生增删时传播冲突，不用旧顺序重试覆盖。
        reorder_queued_submissions(connection, task_id, &ids).await?;
        Ok(true)
    })
    .await
    .map_err(|_| ConnectionError::Timeout)?
}

async fn read_queue_ids(
    connection: &AppServerConnection,
    task_id: &str,
) -> Result<Vec<String>, ConnectionError> {
    let mut ids = Vec::new();
    let mut cursors = HashSet::new();
    let mut cursor = None;
    let mut bytes = 0;
    for _ in 0..MAX_PAGES {
        // 移动只需身份和顺序；反序列化时跳过提示正文、附件和 Skill，避免再次构建内容副本。
        let page: QueueIdPage = connection
            .request(
                "thread/queue/list",
                &json!({
                    "threadId": task_id, "cursor": cursor, "limit": PAGE_LIMIT,
                }),
                TIMEOUT,
            )
            .await?;
        if page.data.len() > PAGE_LIMIT {
            return Err(ConnectionError::InvalidMessage);
        }
        for item in page.data {
            bytes += item.id.len();
            if item.id.is_empty() || item.id.len() > MAX_FIELD_BYTES || bytes > MAX_ID_BYTES {
                return Err(ConnectionError::InvalidMessage);
            }
            ids.push(item.id);
        }
        let Some(next) = page.next_cursor else {
            // 分页期间自动出队可能使页面重叠；重复身份绝不能进入重排写入。
            let unique: HashSet<&str> = ids.iter().map(String::as_str).collect();
            return if unique.len() == ids.len() {
                Ok(ids)
            } else {
                Err(ConnectionError::InvalidMessage)
            };
        };
        if next.is_empty() || next.len() > MAX_FIELD_BYTES || !cursors.insert(next.clone()) {
            return Err(ConnectionError::InvalidMessage);
        }
        cursor = Some(next);
    }
    Err(ConnectionError::InvalidMessage)
}

#[cfg(test)]
#[path = "conversation_queue_move_tests.rs"]
mod tests;
