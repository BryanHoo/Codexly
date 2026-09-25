use super::sidebar::AgentTask;
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskSearchInput {
    pub query: String,
    pub archived: bool,
    pub kind: Option<String>,
    pub cursor: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskSearchPage {
    pub data: Vec<TaskSearchResult>,
    pub next_cursor: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct TaskSearchResult {
    pub task: AgentTask,
    pub snippet: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub occurrence: Option<SearchOccurrence>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchOccurrencesPage {
    pub data: Vec<SearchOccurrence>,
    pub next_cursor: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchOccurrence {
    pub item_id: String,
    pub turn_id: String,
    pub turn_cursor: String,
    pub snippet: String,
    pub snippet_match_range: SearchTextRange,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct SearchTextRange {
    pub start: u32,
    pub end: u32,
}
