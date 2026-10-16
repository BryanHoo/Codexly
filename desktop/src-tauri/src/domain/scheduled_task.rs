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
        scheduled_task_engine(&self.turn_options).is_some()
            && !self.id.is_empty()
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
            && (self.reasoning_effort.is_empty() || !self.reasoning_effort.trim().is_empty())
            && matches!(
                self.sandbox_mode,
                "read-only" | "workspace-write" | "danger-full-access"
            )
    }
}

/// 执行身份由已保存的引擎选项决定；缺省是旧版 Codex，非法选项不能静默回退。
pub fn scheduled_task_engine(options: &AgentTurnOptions) -> Option<&'static str> {
    match options.engine_options.as_ref() {
        None => Some("codex"),
        Some(value)
            if value["engine"] == "claude"
                && matches!(
                    value["permissionMode"].as_str(),
                    Some("default" | "acceptEdits" | "plan" | "dontAsk" | "bypassPermissions")
                ) =>
        {
            Some("claude")
        }
        Some(_) => None,
    }
}

/// 按所属引擎的目录校验模型与推理档位，空档位只适用于未声明档位的模型。
pub fn scheduled_task_model_valid(options: &AgentTurnOptions, models: &serde_json::Value) -> bool {
    let Some(model) = models["data"].as_array().and_then(|items| {
        items
            .iter()
            .find(|item| item["id"].as_str() == Some(options.model.as_str()))
    }) else {
        return false;
    };
    let efforts = model["supportedReasoningEfforts"].as_array();
    match efforts {
        Some(items) if !items.is_empty() => items
            .iter()
            .any(|item| item["id"].as_str() == Some(options.reasoning_effort.as_str())),
        _ => options.reasoning_effort.is_empty(),
    }
}

#[cfg(test)]
mod engine_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn scheduled_engine_should_select_claude_without_changing_legacy_codex() {
        let mut options = AgentTurnOptions::default();
        assert_eq!(scheduled_task_engine(&options), Some("codex"));
        options.engine_options = Some(json!({"engine":"claude","permissionMode":"plan"}));
        assert_eq!(scheduled_task_engine(&options), Some("claude"));
        options.engine_options = Some(json!({"engine":"claude","permissionMode":"invalid"}));
        assert_eq!(scheduled_task_engine(&options), None);
    }

    #[test]
    fn scheduled_model_should_use_selected_catalog_and_declared_efforts() {
        let mut options = AgentTurnOptions {
            model: "sonnet".into(),
            reasoning_effort: "".into(),
            ..AgentTurnOptions::default()
        };
        let catalog = json!({"data":[{"id":"sonnet","supportedReasoningEfforts":[]}]});
        assert!(scheduled_task_model_valid(&options, &catalog));
        assert!(!scheduled_task_model_valid(
            &options,
            &json!({"data":[{"id":"gpt"}]})
        ));
        options.reasoning_effort = "high".into();
        assert!(!scheduled_task_model_valid(&options, &catalog));
        assert!(scheduled_task_model_valid(
            &options,
            &json!({"data":[{"id":"sonnet","supportedReasoningEfforts":[{"id":"high"}]}]})
        ));
    }
}
