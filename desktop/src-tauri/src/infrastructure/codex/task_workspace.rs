use super::{AppServerConnection, ConnectionError};
use serde_json::{Value, json};
use std::{path::Path, time::Duration};

pub async fn update_task_workspace(
    connection: &AppServerConnection,
    task_id: &str,
    cwd: &Path,
) -> Result<(), ConnectionError> {
    if !cwd.is_absolute() {
        return Err(ConnectionError::InvalidMessage);
    }
    // Codex 分配线程 ID 后、首个 Turn 前更新 cwd；后续恢复继续使用官方持久化设置。
    let _: Value = connection
        .request(
            "thread/settings/update",
            &json!({"threadId": task_id, "cwd": cwd}),
            Duration::from_secs(30),
        )
        .await?;
    Ok(())
}
