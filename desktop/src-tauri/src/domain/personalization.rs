use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalInstructions {
    pub content: String,
    pub path: String,
    pub override_active: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MemorySettings {
    pub enabled: bool,
    pub allow_external_context: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MemorySettingsUpdate {
    pub enabled: Option<bool>,
    pub allow_external_context: Option<bool>,
}
