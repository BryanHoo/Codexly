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
        let response: NativePage = connection
            .request(
                "thread/backgroundTerminals/list",
                &ListParams {
                    cursor: cursor.as_deref(),
                    limit: PAGE_LIMIT,
                    thread_id: task_id,
                },
                REQUEST_TIMEOUT,
            )
            .await?;
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
    let response: NativeTerminateResponse = connection
        .request(
            "thread/backgroundTerminals/terminate",
            &TerminateParams {
                process_id: terminal_id,
                thread_id: task_id,
            },
            REQUEST_TIMEOUT,
        )
        .await?;
    if !response.terminated {
        return Err(ConnectionError::InvalidMessage);
    }
    Ok(TerminateBackgroundTerminalResponse {
        status: "terminated",
        terminal_id: terminal_id.to_owned(),
    })
}
