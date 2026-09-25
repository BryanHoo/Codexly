use std::time::Duration;

use serde::Serialize;
use serde_json::Value;

use super::connection::{AppServerConnection, ConnectionError};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ConfigReadParams {
    include_layers: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ConfigBatchWriteParams {
    edits: Vec<ConfigEdit>,
    reload_user_config: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ConfigEdit {
    key_path: String,
    value: Value,
    merge_strategy: &'static str,
}

pub(super) async fn read_config(
    connection: &AppServerConnection,
) -> Result<Value, ConnectionError> {
    let response: Value = connection
        .request(
            "config/read",
            &ConfigReadParams {
                include_layers: false,
            },
            REQUEST_TIMEOUT,
        )
        .await?;
    response
        .get("config")
        .cloned()
        .filter(Value::is_object)
        .ok_or(ConnectionError::InvalidMessage)
}

pub(super) async fn write_config(
    connection: &AppServerConnection,
    edits: Vec<ConfigEdit>,
) -> Result<(), ConnectionError> {
    let _: Value = connection
        .request(
            "config/batchWrite",
            &ConfigBatchWriteParams {
                edits,
                reload_user_config: true,
            },
            REQUEST_TIMEOUT,
        )
        .await?;
    Ok(())
}

pub(super) fn edit(key_path: &str, value: Value) -> ConfigEdit {
    ConfigEdit {
        key_path: key_path.to_owned(),
        value,
        merge_strategy: "replace",
    }
}
