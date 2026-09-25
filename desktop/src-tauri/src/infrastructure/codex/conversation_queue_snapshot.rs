use serde::Serialize;
use std::{
    collections::HashSet,
    io::{self, Write},
    time::Duration,
};

use super::{
    AppServerConnection,
    connection::ConnectionError,
    conversation_queue::{AgentQueuedSubmission, list_queued_submissions},
};

#[derive(Debug, Serialize)]
pub struct QueueSnapshot {
    pub data: Vec<AgentQueuedSubmission>,
}

const MAX_PAGES: usize = 100;
const MAX_BYTES: usize = 4 * 1024 * 1024;
const MAX_CURSOR_BYTES: usize = 4096;
const TIMEOUT: Duration = Duration::from_secs(30);

struct ByteBudget(usize);

impl Write for ByteBudget {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if bytes.len() > self.0 {
            return Err(io::Error::other("Queue snapshot exceeds its byte budget"));
        }
        self.0 -= bytes.len();
        Ok(bytes.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

pub async fn read_queued_submissions(
    connection: &AppServerConnection,
    task_id: &str,
) -> Result<QueueSnapshot, ConnectionError> {
    tokio::time::timeout(TIMEOUT, read_pages(connection, task_id))
        .await
        .map_err(|_| ConnectionError::Timeout)?
}

async fn read_pages(
    connection: &AppServerConnection,
    task_id: &str,
) -> Result<QueueSnapshot, ConnectionError> {
    let mut data = Vec::new();
    let mut cursor = None;
    let mut cursors = HashSet::new();
    // 计入 JSON 信封、逗号，并为唯一编辑项从 queued 变为 editing 预留一个字节。
    let mut budget = ByteBudget(MAX_BYTES - br#"{"data":[]}"#.len() - 1);
    for _ in 0..MAX_PAGES {
        let page =
            list_queued_submissions(connection, task_id, cursor.as_deref(), Some(100)).await?;
        if page.data.len() > 100 {
            return Err(ConnectionError::InvalidMessage);
        }
        for item in page.data {
            if !data.is_empty() {
                budget
                    .write_all(b",")
                    .map_err(|_| ConnectionError::InvalidMessage)?;
            }
            // 只计数字节，不构建第二份 JSON 正文；超限返回错误，绝不把半份队列当完整快照。
            serde_json::to_writer(&mut budget, &item)
                .map_err(|_| ConnectionError::InvalidMessage)?;
            data.push(item);
        }
        let Some(next) = page.next_cursor else {
            let ids: HashSet<&str> = data.iter().map(|item| item.id.as_str()).collect();
            return if ids.len() == data.len() {
                Ok(QueueSnapshot { data })
            } else {
                Err(ConnectionError::InvalidMessage)
            };
        };
        if next.is_empty() || next.len() > MAX_CURSOR_BYTES || !cursors.insert(next.clone()) {
            return Err(ConnectionError::InvalidMessage);
        }
        cursor = Some(next);
    }
    Err(ConnectionError::InvalidMessage)
}

#[cfg(test)]
#[path = "conversation_queue_snapshot_tests.rs"]
mod tests;
