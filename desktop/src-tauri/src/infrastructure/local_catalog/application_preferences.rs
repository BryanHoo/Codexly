use super::{CatalogError, db_error, string};
use rusqlite::{Connection, OptionalExtension, TransactionBehavior};
use serde_json::Value;
use std::sync::OnceLock;

pub(crate) fn contract() -> Result<&'static Value, CatalogError> {
    static CONTRACT: OnceLock<Result<Value, serde_json::Error>> = OnceLock::new();
    CONTRACT
        .get_or_init(|| {
            serde_json::from_str(include_str!(
                "../../../../../packages/protocol/src/application-preferences-sql.json"
            ))
        })
        .as_ref()
        .map_err(|_| CatalogError::InvalidMessage)
}
pub(super) fn initialize(db: &Connection) -> Result<(), CatalogError> {
    db.execute_batch(string(contract()?, "schema")?)
        .map_err(db_error)
}
fn text(v: &Value, min: usize, max: usize) -> bool {
    v.as_str().is_some_and(|s| {
        let n = s.encode_utf16().take(max + 1).count();
        n >= min && n <= max
    })
}
fn valid_field(key: &str, value: &Value) -> bool {
    match key {
        "defaultAgent" => matches!(value.as_str(), Some("codex" | "claude")),
        "defaultModel" => value.is_null() || text(value, 1, 16384),
        "commitMessagePrompt" | "taskTitlePrompt" | "promptOptimizationPrompt" => {
            text(value, 0, 4000)
        }
        "defaultOpenAppId" => {
            value.is_null()
                || matches!(
                    value.as_str(),
                    Some(
                        "visual-studio-code"
                            | "zed"
                            | "windsurf"
                            | "finder"
                            | "terminal"
                            | "ghostty"
                            | "xcode"
                            | "android-studio"
                            | "file-manager"
                            | "gnome-terminal"
                            | "konsole"
                            | "xfce-terminal"
                            | "explorer"
                            | "windows-terminal"
                            | "command-prompt"
                    )
                )
        }
        "followUpBehavior" => matches!(value.as_str(), Some("queue" | "steer")),
        "pet" => value.as_object().is_some_and(|v| {
            v.len() == 2
                && value["enabled"].is_boolean()
                && v.contains_key("selectedPetId")
                && (value["selectedPetId"].is_null() || text(&value["selectedPetId"], 0, 16384))
                && (value["enabled"] == false || text(&value["selectedPetId"], 1, 16384))
        }),
        _ => false,
    }
}
pub(crate) fn encode(value: &Value, partial: bool) -> Result<String, CatalogError> {
    let object = value.as_object().ok_or(CatalogError::InvalidMessage)?;
    if object.is_empty()
        || (!partial && object.len() != 8)
        || !object.iter().all(|(k, v)| valid_field(k, v))
        || (partial && object.contains_key("defaultAgent") != object.contains_key("defaultModel"))
    {
        return Err(CatalogError::InvalidMessage);
    }
    let text = serde_json::to_string(value).map_err(|_| CatalogError::InvalidMessage)?;
    if text.len() > 262144 {
        return Err(CatalogError::InvalidMessage);
    }
    Ok(text)
}
fn read(db: &Connection) -> Result<Value, CatalogError> {
    let text: Option<String> = db
        .query_row(string(contract()?, "read")?, [], |row| row.get(0))
        .optional()
        .map_err(db_error)?;
    let Some(text) = text else {
        return Ok(Value::Null);
    };
    // 校验落盘值；损坏时不能覆盖旧快照或偷偷回退到旧配置。
    let value = serde_json::from_str(&text).map_err(|_| CatalogError::InvalidMessage)?;
    encode(&value, false)?;
    Ok(value)
}
pub(super) fn execute(db: &mut Connection, op: &str, input: &Value) -> Result<Value, CatalogError> {
    if op == "app.preferences.read" {
        return read(db);
    }
    encode(&input["changes"], true)?;
    // 先锁后读；与 Node Worker 的 immediate 事务保证同机跨端字段合并。
    let transaction = db
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(db_error)?;
    let mut current = read(&transaction)?;
    if current.is_null() {
        encode(&input["baseline"], false)?;
        current = input["baseline"].clone();
    }
    let changes = input["changes"]
        .as_object()
        .ok_or(CatalogError::InvalidMessage)?;
    for (key, value) in changes {
        current[key] = value.clone();
    }
    let text = encode(&current, false)?;
    transaction
        .execute(string(contract()?, "write")?, [text])
        .map_err(db_error)?;
    transaction.commit().map_err(db_error)?;
    Ok(current)
}
