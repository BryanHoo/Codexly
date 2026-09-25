use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum WebSearchMode {
    Disabled,
    #[default]
    Cached,
    Live,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ModelVerbosity {
    Low,
    Medium,
    High,
}

/// 从 Codex 全局配置提取运行参数，不混入项目级或任务级持久化设置。
#[derive(Clone, Copy, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRuntimeSettings {
    pub web_search: WebSearchMode,
    pub model_verbosity: Option<ModelVerbosity>,
}
