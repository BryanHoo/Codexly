use super::{AppServerConnection, ConnectionError};
use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Deserialize)]
struct CompressionAcknowledgement {}

#[derive(Serialize)]
pub struct HistoryCompressionResult {
    status: &'static str,
}

pub async fn compress_history(
    connection: &AppServerConnection,
) -> Result<HistoryCompressionResult, ConnectionError> {
    // 原生 worker 负责跨进程互斥、冷文件筛选和原子替换；空回执仅表示请求已提交。
    let _: CompressionAcknowledgement = connection
        .request("rollout/compress", &(), Duration::from_secs(30))
        .await?;
    Ok(HistoryCompressionResult {
        status: "scheduled",
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, duplex, split};

    #[tokio::test]
    async fn compression_should_only_acknowledge_scheduling_and_propagate_errors() {
        let (client, server) = duplex(4096);
        let (reader, writer) = split(client);
        let connection = AppServerConnection::new(reader, writer);
        let (reader, mut writer) = split(server);
        let server = tokio::spawn(async move {
            let mut lines = BufReader::new(reader).lines();
            for result in [json!({}), json!(null)] {
                let request: Value =
                    serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
                assert_eq!(request["method"], "rollout/compress");
                assert!(request["params"].is_null());
                writer
                    .write_all(
                        format!("{}\n", json!({"id": request["id"], "result": result})).as_bytes(),
                    )
                    .await
                    .unwrap();
            }
            let request: Value =
                serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
            writer.write_all(format!("{}\n", json!({"id": request["id"], "error": {"code": -32600, "message": "unsupported store"}})).as_bytes()).await.unwrap();
        });
        assert_eq!(
            serde_json::to_value(compress_history(&connection).await.unwrap()).unwrap(),
            json!({"status": "scheduled"})
        );
        assert!(compress_history(&connection).await.is_err());
        assert!(compress_history(&connection).await.is_err());
        server.await.unwrap();
    }
}
