//! 应用配置使用固定结构；仅 granular 内的 Codex 扩展数据保留动态值。
use crate::infrastructure::settings_object::object;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(super) enum ApprovalMode {
    OnRequest,
    Never,
    Untrusted,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct GranularApproval {
    granular: Map<String, Value>,
}

#[derive(Deserialize, Serialize)]
#[serde(untagged)]
pub(super) enum ApprovalPolicy {
    Mode(ApprovalMode),
    Granular(#[serde(deserialize_with = "object")] GranularApproval),
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum ApprovalsReviewer {
    User,
    AutoReview,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(super) enum SandboxMode {
    ReadOnly,
    WorkspaceWrite,
    DangerFullAccess,
}

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub(super) enum FollowUpBehavior {
    #[default]
    Queue,
    Steer,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub(super) enum WebSearch {
    Disabled,
    Cached,
    Live,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub(super) enum ModelVerbosity {
    Low,
    Medium,
    High,
}

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct PetSettings {
    pub enabled: bool,
    // nullable 不代表可省略：输入必须明确表达未选择状态。
    #[serde(deserialize_with = "Option::deserialize")]
    pub selected_pet_id: Option<String>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct ProjectSettings {
    pub approval_policy: ApprovalPolicy,
    pub approvals_reviewer: ApprovalsReviewer,
    pub fast_mode: bool,
    pub model: String,
    pub reasoning_effort: String,
    pub sandbox_mode: SandboxMode,
}

impl ProjectSettings {
    pub fn is_valid(&self) -> bool {
        non_empty(&self.model, 256) && non_empty(&self.reasoning_effort, 64)
    }
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct GlobalSettings {
    pub approval_policy: ApprovalPolicy,
    pub approvals_reviewer: ApprovalsReviewer,
    pub commit_message_model: String,
    pub commit_message_prompt: String,
    #[serde(deserialize_with = "Option::deserialize")]
    pub default_open_app_id: Option<String>,
    pub fast_mode: bool,
    pub follow_up_behavior: FollowUpBehavior,
    pub model: String,
    #[serde(deserialize_with = "Option::deserialize")]
    pub model_verbosity: Option<ModelVerbosity>,
    #[serde(deserialize_with = "object")]
    pub pet: PetSettings,
    pub reasoning_effort: String,
    pub sandbox_mode: SandboxMode,
    pub web_search: WebSearch,
}

impl GlobalSettings {
    pub fn is_valid(&self) -> bool {
        non_empty(&self.model, 256)
            && non_empty(&self.reasoning_effort, 64)
            && non_empty(&self.commit_message_model, 256)
            && self.commit_message_prompt.len() <= 4_000
            && !matches!(
                self.approval_policy,
                ApprovalPolicy::Mode(ApprovalMode::Untrusted)
            )
    }

    pub fn into_local(self) -> LocalPreferences {
        // 智能体配置由 Codex 管理，仅投影应用自身拥有的五个字段落盘。
        LocalPreferences {
            commit_message_model: self.commit_message_model,
            commit_message_prompt: self.commit_message_prompt,
            default_open_app_id: self.default_open_app_id,
            follow_up_behavior: self.follow_up_behavior,
            pet: self.pet,
        }
    }
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub(super) struct LocalPreferences {
    pub commit_message_model: String,
    pub commit_message_prompt: String,
    pub default_open_app_id: Option<String>,
    pub follow_up_behavior: FollowUpBehavior,
    #[serde(deserialize_with = "object")]
    pub pet: PetSettings,
}

impl Default for LocalPreferences {
    fn default() -> Self {
        Self {
            commit_message_model: "gpt-5.6-luna".into(),
            commit_message_prompt: String::new(),
            default_open_app_id: None,
            follow_up_behavior: FollowUpBehavior::Queue,
            pet: PetSettings::default(),
        }
    }
}

impl LocalPreferences {
    pub fn is_valid(&self) -> bool {
        non_empty(&self.commit_message_model, 256) && self.commit_message_prompt.len() <= 4_000
    }
}

fn non_empty(value: &str, max: usize) -> bool {
    !value.trim().is_empty() && value.len() <= max
}
