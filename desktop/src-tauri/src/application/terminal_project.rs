use super::{app_storage_runtime::AppStorageRuntime, error::AppError};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use tauri::{AppHandle, Manager};

fn preference_key(project_id: &str) -> String {
    use std::fmt::Write;
    let mut key = String::from("codeagent.project-terminal.");
    for byte in Sha256::digest(project_id.as_bytes()) {
        let _ = write!(key, "{byte:02x}");
    }
    key
}

pub(super) async fn remove_preferences(app: &AppHandle, project_id: &str) -> Result<(), AppError> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    // 删除也通过同一 Rust actor 排序，不绕过已有存储写入队列。
    app.state::<AppStorageRuntime>()
        .enqueue(
            app_data,
            BTreeMap::from([(preference_key(project_id), None)]),
        )
        .await
}

#[cfg(test)]
mod tests {
    #[test]
    fn layout_key_matches_frontend_sha256_contract() {
        assert_eq!(
            super::preference_key("p"),
            "codeagent.project-terminal.148de9c5a7a44d19e56cd9ae1a554bf67847afb0c58f6e12fa29ac7ddfca9940"
        );
    }
}
