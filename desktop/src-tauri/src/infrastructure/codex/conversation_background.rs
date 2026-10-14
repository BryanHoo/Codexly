use std::{collections::HashSet, time::Duration};

use serde::{Deserialize, Serialize};

use super::{AppServerConnection, connection::ConnectionError};

const PAGE_LIMIT: u32 = 100;
const MAX_PAGES: usize = 100;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ListParams<'a> {
    cursor: Option<&'a str>,
    limit: u32,
    thread_id: &'a str,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativePage {
    data: Vec<NativeTerminal>,
    next_cursor: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeTerminal {
    command: String,
    cwd: String,
    item_id: String,
    process_id: String,
}

#[derive(Debug, Serialize)]
pub struct AgentBackgroundTerminalPage {
    pub data: Vec<AgentBackgroundTerminal>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentBackgroundTerminal {
    pub command: String,
    pub cwd: String,
    pub id: String,
    pub item_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminateParams<'a> {
    process_id: &'a str,
    thread_id: &'a str,
}

#[derive(Deserialize)]
struct NativeTerminateResponse {
    terminated: bool,
}

fn is_thread_missing_error(error: &ConnectionError) -> bool {
    matches!(error, ConnectionError::Request { code: -32600, message } if message.starts_with("thread not found:"))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminateBackgroundTerminalResponse {
    pub status: &'static str,
    pub terminal_id: String,
}

pub async fn list_background_terminals(
    connection: &AppServerConnection,
    task_id: &str,
) -> Result<AgentBackgroundTerminalPage, ConnectionError> {
    let mut cursor = None;
    let mut seen_cursors = HashSet::new();
    let mut data = Vec::new();
    for _ in 0..MAX_PAGES {
        let response: NativePage = match connection
            .request(
                "thread/backgroundTerminals/list",
                &ListParams {
                    cursor: cursor.as_deref(),
                    limit: PAGE_LIMIT,
                    thread_id: task_id,
                },
                REQUEST_TIMEOUT,
            )
            .await
        {
            Ok(response) => response,
            // 历史线程已释放时没有后台进程，不恢复线程，也不把陈旧列表继续显示为运行中。
            Err(error) if is_thread_missing_error(&error) => {
                return Ok(AgentBackgroundTerminalPage { data: Vec::new() });
            }
            Err(error) => return Err(error),
        };
        for terminal in response.data {
            if terminal.process_id.is_empty()
                || terminal.item_id.is_empty()
                || terminal.command.is_empty()
                || terminal.cwd.is_empty()
            {
                return Err(ConnectionError::InvalidMessage);
            }
            data.push(AgentBackgroundTerminal {
                command: terminal.command,
                cwd: terminal.cwd,
                id: terminal.process_id,
                item_id: terminal.item_id,
            });
        }
        let Some(next_cursor) = response.next_cursor else {
            return Ok(AgentBackgroundTerminalPage { data });
        };
        if !seen_cursors.insert(next_cursor.clone()) {
            return Err(ConnectionError::InvalidMessage);
        }
        cursor = Some(next_cursor);
    }
    Err(ConnectionError::InvalidMessage)
}

pub async fn terminate_background_terminal(
    connection: &AppServerConnection,
    task_id: &str,
    terminal_id: &str,
) -> Result<TerminateBackgroundTerminalResponse, ConnectionError> {
    if terminal_id.is_empty() {
        return Err(ConnectionError::InvalidMessage);
    }
    let response: NativeTerminateResponse = match connection
        .request(
            "thread/backgroundTerminals/terminate",
            &TerminateParams {
                process_id: terminal_id,
                thread_id: task_id,
            },
            REQUEST_TIMEOUT,
        )
        .await
    {
        Ok(response) => response,
        // 与 Web 保持一致：线程已释放等价于目标终端已退出，结束操作可以幂等成功。
        Err(error) if is_thread_missing_error(&error) => {
            NativeTerminateResponse { terminated: true }
        }
        Err(error) => return Err(error),
    };
    if !response.terminated {
        // false 既可能表示进程已退出，也可能表示终止失败；仅在权威列表仍包含它时报错。
        let terminals = list_background_terminals(connection, task_id).await?;
        if terminals
            .data
            .iter()
            .any(|terminal| terminal.id == terminal_id)
        {
            return Err(ConnectionError::InvalidMessage);
        }
    }
    Ok(TerminateBackgroundTerminalResponse {
        status: "terminated",
        terminal_id: terminal_id.to_owned(),
    })
}
