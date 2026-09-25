use std::sync::atomic::{AtomicU64, Ordering};

use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, duplex, split};

use super::{AppServerConnection, auth::ensure_custom_model_discovery, configure_custom_provider};

static TEST_ROOT_ID: AtomicU64 = AtomicU64::new(1);

fn test_root() -> std::path::PathBuf {
    let id = TEST_ROOT_ID.fetch_add(1, Ordering::Relaxed);
    std::env::temp_dir().join(format!(
        "codeagent-provider-config-{}-{id}",
        std::process::id()
    ))
}

#[tokio::test]
async fn openai_override_reconnect_should_select_custom_catalog() {
    let root = test_root();
    let (client, server) = duplex(32 * 1024);
    let (client_reader, client_writer) = split(client);
    let (server_reader, mut server_writer) = split(server);
    let connection = AppServerConnection::new(client_reader, client_writer);

    let server_task = tokio::spawn(async move {
        let mut lines = BufReader::new(server_reader).lines();
        let config_read: Value =
            serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
        assert_eq!(config_read["method"], "config/read");
        server_writer
            .write_all(
                format!(
                    "{}\n",
                    json!({
                        "id": config_read["id"].clone(),
                        "result": {
                            "config": {
                                "model_provider": "openai",
                                "openai_base_url": "https://old.example/v1"
                            }
                        }
                    })
                )
                .as_bytes(),
            )
            .await
            .unwrap();

        let config_write: Value =
            serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
        let edits = config_write["params"]["edits"].as_array().unwrap();
        assert!(
            edits
                .iter()
                .any(|edit| { edit["keyPath"] == "openai_base_url" && edit["value"].is_null() })
        );
        assert!(
            edits
                .iter()
                .any(|edit| edit["keyPath"] == "model_provider" && edit["value"] == "OpenAI")
        );
        assert!(
            edits
                .iter()
                .any(|edit| edit["keyPath"] == "model_providers.OpenAI"
                    && edit["value"]["model_catalog_url"] == "https://new.example/v1/models")
        );
        assert!(
            edits
                .iter()
                .all(|edit| edit["keyPath"] != "model_providers.openai")
        );
        server_writer
            .write_all(
                format!(
                    "{}\n",
                    json!({"id": config_write["id"].clone(), "result": {}})
                )
                .as_bytes(),
            )
            .await
            .unwrap();
    });

    configure_custom_provider(
        &connection,
        &root,
        json!({"baseUrl": "https://new.example/v1"}),
    )
    .await
    .unwrap();
    server_task.await.unwrap();
}

#[tokio::test]
async fn legacy_custom_provider_should_gain_catalog_on_next_model_read() {
    let (client, server) = duplex(32 * 1024);
    let (client_reader, client_writer) = split(client);
    let (server_reader, mut server_writer) = split(server);
    let connection = AppServerConnection::new(client_reader, client_writer);
    let server_task = tokio::spawn(async move {
        let mut lines = BufReader::new(server_reader).lines();
        let read: Value = serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
        assert_eq!(read["method"], "config/read");
        server_writer.write_all(format!("{}\n", json!({
            "id": read["id"], "result": {"config": {
                "model_provider": "relay", "model_providers": {"relay": {
                    "name": "Relay", "base_url": "https://relay.example/v1", "wire_api": "responses",
                    "env_key": null, "http_headers": null, "query_params": null
                }}
            }}
        })).as_bytes()).await.unwrap();

        let write: Value =
            serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
        assert_eq!(write["method"], "config/batchWrite");
        let edits = write["params"]["edits"].as_array().unwrap();
        assert!(edits.iter().any(|edit| edit["keyPath"]
            == "model_providers.relay.model_catalog_url"
            && edit["value"] == "https://relay.example/v1/models"));
        assert!(edits.iter().all(|edit| !edit["value"].is_object()));
        assert!(
            edits
                .iter()
                .any(|edit| edit["keyPath"] == "features.api_key_model_discovery"
                    && edit["value"] == true)
        );
        server_writer
            .write_all(format!("{}\n", json!({"id": write["id"], "result": {}})).as_bytes())
            .await
            .unwrap();
    });
    assert!(ensure_custom_model_discovery(&connection).await.unwrap());
    server_task.await.unwrap();
}
