use serde::{Deserialize, Serialize};

use super::conversation::{AgentPromptInput, AgentTurnOptions};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "type"
)]
pub enum ScheduledTaskSchedule {
    #[serde(rename = "once")]
    Once { at_unix_ms: i64 },
    #[serde(rename = "rrule")]
    Rrule {
        rrule: String,
        start_at_unix_ms: i64,
        timezone: String,
    },
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ScheduledTaskRunStatus {
    Failed,
    Running,
    Skipped,
    Started,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledTaskInput {
    pub enabled: bool,
    pub name: String,
    pub project_id: String,
    pub project_name: String,
    pub prompt: AgentPromptInput,
    pub schedule: ScheduledTaskSchedule,
    pub turn_options: AgentTurnOptions,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledTaskRun {
    pub error: Option<String>,
    pub finished_at_unix_ms: Option<i64>,
    pub id: String,
    pub started_at_unix_ms: i64,
    pub status: ScheduledTaskRunStatus,
    pub task_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledTask {
    pub created_at_unix_ms: i64,
    pub enabled: bool,
    pub id: String,
    pub last_run_at_unix_ms: Option<i64>,
    pub last_run_status: Option<ScheduledTaskRunStatus>,
    pub name: String,
    pub next_run_at_unix_ms: Option<i64>,
    pub project_id: String,
    pub project_name: String,
    pub prompt: AgentPromptInput,
    pub runs: Vec<ScheduledTaskRun>,
    pub schedule: ScheduledTaskSchedule,
    pub turn_options: AgentTurnOptions,
    pub updated_at_unix_ms: i64,
}

#[derive(Debug, Serialize)]
pub struct ScheduledTaskPage {
    pub data: Vec<ScheduledTask>,
}

impl ScheduledTask {
    pub fn is_valid(&self) -> bool {
        !self.id.is_empty()
            && self.id.len() <= 128
            && !self.name.trim().is_empty()
            && self.name.len() <= 120
            && !self.project_id.trim().is_empty()
            && self.project_id.len() <= 128
            && !self.project_name.trim().is_empty()
            && self.project_name.len() <= 256
            && self.prompt.text.len() <= 100_000
            && (!self.prompt.text.trim().is_empty()
                || !self.prompt.attachments.is_empty()
                || !self.prompt.skills.is_empty())
            && AgentTaskSettingsView::from(&self.turn_options).is_valid()
    }
}

struct AgentTaskSettingsView<'a> {
    approval_policy: &'a serde_json::Value,
    approvals_reviewer: &'a str,
    model: &'a str,
    reasoning_effort: &'a str,
    sandbox_mode: &'a str,
}

impl<'a> From<&'a AgentTurnOptions> for AgentTaskSettingsView<'a> {
    fn from(value: &'a AgentTurnOptions) -> Self {
        Self {
            approval_policy: &value.approval_policy,
            approvals_reviewer: &value.approvals_reviewer,
            model: &value.model,
            reasoning_effort: &value.reasoning_effort,
            sandbox_mode: &value.sandbox_mode,
        }
    }
}

impl AgentTaskSettingsView<'_> {
    fn is_valid(&self) -> bool {
        let approval_valid = self
            .approval_policy
            .as_str()
            .is_some_and(|value| matches!(value, "untrusted" | "on-request" | "never"))
            || self
                .approval_policy
                .as_object()
                .is_some_and(|value| !value.is_empty());
        approval_valid
            && matches!(self.approvals_reviewer, "user" | "auto_review")
            && !self.model.trim().is_empty()
            && !self.reasoning_effort.trim().is_empty()
            && matches!(
                self.sandbox_mode,
                "read-only" | "workspace-write" | "danger-full-access"
            )
    }
}
