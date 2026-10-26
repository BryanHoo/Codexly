use super::{AppServerConnection, connection::ConnectionError};
use serde::Deserialize;
use serde_json::json;
use std::{path::Path, time::Duration};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FeedbackSaveResponse {
    saved_path: String,
    thread_id: String,
    prompt_hash: Option<String>,
}

pub async fn save_codex_diagnostics(
    connection: &AppServerConnection,
    path: &Path,
) -> Result<(), ConnectionError> {
    let save_path = path
        .to_str()
        .filter(|_| path.is_absolute())
        .ok_or(ConnectionError::InvalidMessage)?;
    // 本地诊断固定使用宿主私有目录中的全新路径，绝不改走 feedback/upload。
    let response: FeedbackSaveResponse = connection
        .request(
            "feedback/save",
            &json!({
                "savePath": save_path, "classification": "bug", "includeLogs": true,
            }),
            Duration::from_secs(120),
        )
        .await?;
    if response.saved_path != save_path {
        return Err(ConnectionError::InvalidMessage);
    }
    let _ = (response.thread_id, response.prompt_hash);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, duplex, split};

    #[tokio::test]
    async fn native_diagnostics_use_local_save_and_reject_foreign_paths() {
        for valid in [true, false] {
            let directory = tempfile::tempdir().unwrap();
            let path = directory.path().join("native.zip");
            let saved_path = path.to_string_lossy().into_owned();
            let (client, server) = duplex(8 * 1024);
            let (reader, writer) = split(client);
            let (server_reader, mut server_writer) = split(server);
            let connection = AppServerConnection::new(reader, writer);
            let server_task = tokio::spawn(async move {
                let mut lines = BufReader::new(server_reader).lines();
                let request: Value =
                    serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
                assert_eq!(request["method"], "feedback/save");
                assert_eq!(
                    request["params"],
                    json!({"savePath": saved_path, "classification":"bug", "includeLogs":true})
                );
                let response = json!({"id":request["id"], "result":{"savedPath":if valid {saved_path} else {"/foreign.zip".to_owned()}, "threadId":"", "promptHash":null}});
                server_writer
                    .write_all(format!("{response}\n").as_bytes())
                    .await
                    .unwrap();
            });
            assert_eq!(
                save_codex_diagnostics(&connection, &path).await.is_ok(),
                valid
            );
            server_task.await.unwrap();
        }
    }
}
