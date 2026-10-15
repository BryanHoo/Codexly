use std::sync::atomic::{AtomicU64, Ordering};

use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, duplex, split};

use crate::infrastructure::provider_models::{read_provider_models, write_provider_models};

use super::{AppServerConnection, list_provider_models};

static TEST_ROOT_ID: AtomicU64 = AtomicU64::new(1);

#[tokio::test]
async fn all_layers_unavailable_should_reject_empty_corrupt_or_mismatched_cache() {
    for kind in [
        "missing",
        "empty",
        "other-provider",
        "other-endpoint",
        "corrupt",
    ] {
        let root = tempfile::tempdir().unwrap();
        let page = if kind == "empty" {
            json!({"data":[],"nextCursor":null})
        } else {
            json!({"data":[{"id":"cached","displayName":"Cached"}],"nextCursor":null})
        };
        if kind != "missing" {
            write_provider_models(
                root.path(),
                if kind == "other-provider" {
                    "other"
                } else {
                    "relay"
                },
                if kind == "other-endpoint" {
                    "https://other.example/v1"
                } else {
                    "https://relay.example/v1"
                },
                &page,
            )
            .await
            .unwrap();
        }
        if kind == "corrupt" {
            tokio::fs::write(
                root.path().join("providers/codex/custom-models.json"),
                "invalid-json",
            )
            .await
            .unwrap();
        }
        let (client, server) = duplex(4096);
        let (reader, writer) = split(client);
        let (server_reader, mut server_writer) = split(server);
        let connection = AppServerConnection::new(reader, writer);
        let task = tokio::spawn(async move {
            let mut lines = BufReader::new(server_reader).lines();
            let request: Value =
                serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
            server_writer.write_all(format!("{}\n",json!({"id":request["id"],"result":{"config":{"model_provider":"relay","model_providers":{"relay":{"base_url":"https://relay.example/v1","requires_openai_auth":true}}}}})).as_bytes()).await.unwrap();
        });
        let result = list_provider_models(&connection, root.path(), root.path(), || async {
            Ok(json!({"data":[],"nextCursor":null}))
        })
        .await;
        assert!(
            matches!(result, Err(super::auth::ProviderError::Unavailable)),
            "cache case: {kind}"
        );
        task.await.unwrap();
    }
}

#[tokio::test]
async fn custom_http_catalog_should_be_used_after_empty_cli() {
    let root = tempfile::tempdir().unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base_url = format!("http://{}", listener.local_addr().unwrap());
    let api_task = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        let mut request = vec![0; 4096];
        let count = tokio::io::AsyncReadExt::read(&mut stream, &mut request)
            .await
            .unwrap();
        assert!(
            std::str::from_utf8(&request[..count])
                .unwrap()
                .starts_with("GET /models ")
        );
        let body = r#"{"data":[{"id":"api-model","name":"API Model"}]}"#;
        stream.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).as_bytes()).await.unwrap();
    });
    let (client, server) = duplex(4096);
    let (reader, writer) = split(client);
    let (server_reader, mut server_writer) = split(server);
    let connection = AppServerConnection::new(reader, writer);
    let rpc_task = tokio::spawn(async move {
        let mut lines = BufReader::new(server_reader).lines();
        let read: Value = serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
        server_writer.write_all(format!("{}\n", json!({"id":read["id"],"result":{"config":{"model_provider":"relay","model_providers":{"relay":{"base_url":base_url,"requires_openai_auth":false}}}}})).as_bytes()).await.unwrap();
        if let Ok(Some(line)) =
            tokio::time::timeout(std::time::Duration::from_millis(100), lines.next_line())
                .await
                .unwrap_or(Ok(None))
        {
            let request: Value = serde_json::from_str(&line).unwrap();
            server_writer
                .write_all(
                    format!(
                        "{}\n",
                        json!({"id":request["id"],"result":{"data":[],"nextCursor":null}})
                    )
                    .as_bytes(),
                )
                .await
                .unwrap();
            return true;
        }
        false
    });
    let result = list_provider_models(&connection, root.path(), root.path(), || async {
        Ok(super::catalogs::list_models(&connection).await?)
    })
    .await
    .unwrap();
    assert_eq!(result["data"][0]["id"], "api-model");
    assert!(
        rpc_task.await.unwrap(),
        "the native catalog must be queried before the plain API"
    );
    api_task.await.unwrap();
}

#[tokio::test]
async fn model_list_failure_or_empty_result_should_use_matching_custom_cache() {
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

        let result = list_provider_models(&connection, &root, &root, || async {
            Ok(super::catalogs::list_models(&connection).await?)
        })
        .await;
        assert_eq!(result.unwrap()["data"][0]["id"], "cached-a");
        assert_eq!(
            read_provider_models(&root, "relay", "https://relay.example/v1")
                .await
                .unwrap(),
            Some(cached)
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
}
