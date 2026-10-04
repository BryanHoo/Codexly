use std::sync::atomic::{AtomicU64, Ordering};

use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, duplex, split};

use crate::infrastructure::provider_models::{read_provider_models, write_provider_models};

use super::{AppServerConnection, list_provider_models};

static TEST_ROOT_ID: AtomicU64 = AtomicU64::new(1);

#[tokio::test]
async fn model_list_failure_or_empty_result_should_not_restore_a_stale_custom_catalog() {
    for fail in [true, false] {
        let root = std::env::temp_dir().join(format!(
            "codeagent-model-fallback-{}-{}",
            std::process::id(),
            TEST_ROOT_ID.fetch_add(1, Ordering::Relaxed)
        ));
        let cached = json!({
            "data": [{"id": "cached-a", "displayName": "Cached A"}], "nextCursor": null
        });
        write_provider_models(&root, "relay", "https://relay.example/v1", &cached)
            .await
            .unwrap();
        let (client, server) = duplex(32 * 1024);
        let (reader, writer) = split(client);
        let (server_reader, mut server_writer) = split(server);
        let connection = AppServerConnection::new(reader, writer);
        let server_task = tokio::spawn(async move {
            let mut lines = BufReader::new(server_reader).lines();
            let read: Value =
                serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
            server_writer
                .write_all(
                    format!(
                        "{}\n",
                        json!({
                            "id": read["id"], "result": {"config": {
                                "model_provider": "relay", "model_providers": {"relay": {
                                    "base_url": "https://relay.example/v1"
                                }}
                            }}
                        })
                    )
                    .as_bytes(),
                )
                .await
                .unwrap();
            let list: Value =
                serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
            assert_eq!(list["method"], "model/list");
            server_writer
            .write_all(
                format!(
                    "{}\n",
                    if fail {
                        json!({"id": list["id"], "error": {"code": -32000, "message": "offline"}})
                    } else {
                        json!({"id": list["id"], "result": {"data": [], "nextCursor": null}})
                    }
                )
                .as_bytes(),
            )
            .await
            .unwrap();
        });

        let result = list_provider_models(&connection, &root).await;
        if fail {
            assert!(
                result.is_err(),
                "stale models must not hide the error: {result:?}"
            );
        } else {
            let empty = json!({"data": [], "nextCursor": null});
            assert_eq!(result.unwrap(), empty);
            assert_eq!(
                read_provider_models(&root, "relay", "https://relay.example/v1")
                    .await
                    .unwrap(),
                Some(empty)
            );
        }
        assert_eq!(
            read_provider_models(&root, "other", "https://relay.example/v1")
                .await
                .unwrap(),
            None
        );
        assert_eq!(
            read_provider_models(&root, "relay", "https://other.example/v1")
                .await
                .unwrap(),
            None
        );
        server_task.await.unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }
}
