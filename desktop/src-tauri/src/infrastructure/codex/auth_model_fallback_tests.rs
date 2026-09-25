use std::sync::atomic::{AtomicU64, Ordering};

use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, duplex, split};

use crate::infrastructure::provider_models::{read_provider_models, write_provider_models};

use super::{AppServerConnection, list_provider_models};

static TEST_ROOT_ID: AtomicU64 = AtomicU64::new(1);

#[tokio::test]
async fn model_list_failure_should_restore_only_matching_custom_catalog() {
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
        let read: Value = serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
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
        let list: Value = serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
        assert_eq!(list["method"], "model/list");
        server_writer
            .write_all(
                format!(
                    "{}\n",
                    json!({
                        "id": list["id"], "error": {"code": -32000, "message": "offline"}
                    })
                )
                .as_bytes(),
            )
            .await
            .unwrap();
    });

    let models = list_provider_models(&connection, &root).await.unwrap();
    assert_eq!(models["data"][0]["id"], "cached-a");
    assert_eq!(models["data"][0]["defaultReasoningEffort"], "medium");
    assert_eq!(
        models["data"][0]["supportedReasoningEfforts"]
            .as_array()
            .unwrap()
            .len(),
        3
    );
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
