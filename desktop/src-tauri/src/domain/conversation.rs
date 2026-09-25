use serde::{Deserialize, Serialize, Serializer, ser::SerializeStruct};
use serde_json::Value;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EventCheckpoint {
    pub sequence: u64,
    pub session_id: &'static str,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTaskSettings {
    pub approval_policy: Value,
    pub approvals_reviewer: String,
    pub model: String,
    pub reasoning_effort: String,
    pub sandbox_mode: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentPromptInput {
    #[serde(default)]
    pub attachments: Vec<Value>,
    #[serde(default)]
    pub skills: Vec<Value>,
    pub text: String,
}

impl Serialize for AgentPromptInput {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut state = serializer.serialize_struct("AgentPromptInput", 4)?;
        state.serialize_field("attachments", &self.attachments)?;
        state.serialize_field("skills", &self.skills)?;
        state.serialize_field("text", &self.text)?;
        state.serialize_field("type", "prompt")?;
        state.end()
    }
}

impl AgentPromptInput {
    #[cfg(test)]
    pub fn text(value: &str) -> Self {
        Self {
            attachments: Vec::new(),
            skills: Vec::new(),
            text: value.to_owned(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTurnOptions {
    pub approval_policy: Value,
    pub approvals_reviewer: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub collaboration_mode: Option<String>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub fast_mode: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub goal_mode: bool,
    pub model: String,
    pub reasoning_effort: String,
    pub sandbox_mode: String,
}

fn is_false(value: &bool) -> bool {
    !*value
}

impl Default for AgentTurnOptions {
    fn default() -> Self {
        Self {
            approval_policy: Value::String("on-request".to_owned()),
            approvals_reviewer: "user".to_owned(),
            collaboration_mode: None,
            fast_mode: false,
            goal_mode: false,
            model: "gpt-5.6-sol".to_owned(),
            reasoning_effort: "high".to_owned(),
            sandbox_mode: "workspace-write".to_owned(),
        }
    }
}

impl Default for AgentTaskSettings {
    fn default() -> Self {
        Self {
            approval_policy: Value::String("on-request".to_owned()),
            approvals_reviewer: "user".to_owned(),
            model: "gpt-5.6-sol".to_owned(),
            reasoning_effort: "high".to_owned(),
            sandbox_mode: "workspace-write".to_owned(),
        }
    }
}

impl From<&AgentTurnOptions> for AgentTaskSettings {
    fn from(options: &AgentTurnOptions) -> Self {
        Self {
            approval_policy: options.approval_policy.clone(),
            approvals_reviewer: options.approvals_reviewer.clone(),
            model: options.model.clone(),
            reasoning_effort: options.reasoning_effort.clone(),
            sandbox_mode: options.sandbox_mode.clone(),
        }
    }
}

impl AgentTaskSettings {
    pub fn is_valid(&self) -> bool {
        let approval_valid = self
            .approval_policy
            .as_str()
            .is_some_and(|value| matches!(value, "untrusted" | "on-request" | "never"))
            || self
                .approval_policy
                .as_object()
                .is_some_and(|value| !value.is_empty());
        approval_valid
            && matches!(self.approvals_reviewer.as_str(), "user" | "auto_review")
            && !self.model.trim().is_empty()
            && !self.reasoning_effort.trim().is_empty()
            && matches!(
                self.sandbox_mode.as_str(),
                "read-only" | "workspace-write" | "danger-full-access"
            )
    }
}

#[derive(Debug, Serialize)]
pub struct AgentTaskSnapshotResponse {
    pub checkpoint: EventCheckpoint,
    pub snapshot: AgentTaskSnapshot,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartAgentTurnResponse {
    pub checkpoint: EventCheckpoint,
    pub task_id: String,
    pub turn: AgentTurn,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTurnActionResponse {
    pub status: &'static str,
    pub task_id: String,
    pub turn_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTaskSnapshot {
    pub context_usage: Option<Value>,
    pub goal: Option<AgentGoal>,
    pub id: String,
    pub pending_requests: Vec<Value>,
    pub pinned: bool,
    pub plan: Option<Value>,
    pub project_id: String,
    pub settings: AgentTaskSettings,
    pub thread_configuration: AgentThreadConfiguration,
    pub status: &'static str,
    pub title: String,
    pub turns: Vec<AgentTurn>,
    pub turns_next_cursor: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentThreadConfiguration {
    pub model: Option<String>,
    pub reasoning_effort: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentGoal {
    pub created_at: String,
    pub objective: String,
    pub status: &'static str,
    pub time_used_seconds: i64,
    pub token_budget: Option<i64>,
    pub tokens_used: i64,
    pub updated_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTurn {
    pub completed_at: Option<String>,
    pub error: Option<String>,
    pub id: String,
    pub items: Vec<AgentItem>,
    pub started_at: Option<String>,
    pub status: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(tag = "type")]
pub enum AgentItem {
    #[serde(rename = "message")]
    Message {
        #[serde(skip_serializing_if = "Option::is_none")]
        attachments: Option<Vec<Value>>,
        id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        phase: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        questions: Option<Vec<AgentAsyncQuestion>>,
        role: &'static str,
        #[serde(rename = "skillExpansion", skip_serializing_if = "is_false")]
        skill_expansion: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        skills: Option<Vec<Value>>,
        text: String,
    },
    #[serde(rename = "command")]
    Command {
        command: String,
        cwd: String,
        #[serde(rename = "exitCode", skip_serializing_if = "Option::is_none")]
        exit_code: Option<i64>,
        id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        output: Option<String>,
        #[serde(rename = "outputOmitted")]
        output_omitted: AgentCommandOutputOmission,
        status: &'static str,
    },
    #[serde(rename = "file_change")]
    FileChange {
        changes: Vec<AgentFileChange>,
        id: String,
        status: &'static str,
    },
    #[serde(rename = "tool")]
    Tool {
        id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        input: Option<Value>,
        name: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        output: Option<Value>,
        status: &'static str,
    },
    #[serde(rename = "plan")]
    Plan { id: String, text: String },
    #[serde(rename = "reasoning")]
    Reasoning { id: String, text: String },
    #[serde(rename = "activity")]
    Activity {
        #[serde(skip_serializing_if = "Option::is_none")]
        detail: Option<String>,
        id: String,
        label: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        status: Option<&'static str>,
        #[serde(skip_serializing_if = "Option::is_none")]
        transient: Option<bool>,
    },
    #[serde(rename = "review")]
    Review { id: String, target: Value },
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AgentAsyncQuestion {
    pub title: String,
    pub options: Option<Vec<String>>,
}

#[derive(Debug, Serialize)]
pub struct AgentCommandOutputOmission {
    pub bytes: usize,
    pub lines: usize,
}

#[derive(Debug, Serialize)]
pub struct AgentFileChange {
    pub stats: super::file_change::FileChangeStats,
    pub diff: String,
    pub kind: &'static str,
    pub path: String,
}
