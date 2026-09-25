use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, duplex, split};

use super::{AppServerConnection, get_provider_connection};

async fn read_provider_connection(config: Value, account: Value) -> Value {
    let (client, server) = duplex(32 * 1024);
    let (client_reader, client_writer) = split(client);
    let (server_reader, mut server_writer) = split(server);
    let connection = AppServerConnection::new(client_reader, client_writer);

    let server_task = tokio::spawn(async move {
        let mut lines = BufReader::new(server_reader).lines();
        for result in [json!({"config": config}), account] {
            let request: Value =
                serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
            server_writer
                .write_all(
                    format!(
                        "{}\n",
                        json!({"id": request["id"].clone(), "result": result})
                    )
                    .as_bytes(),
                )
                .await
                .unwrap();
        }
    });

    let status = get_provider_connection(&connection, None).await.unwrap();
    server_task.await.unwrap();
    status
}

#[tokio::test]
async fn provider_connection_should_detect_selected_custom_provider_without_login() {
    let status = read_provider_connection(
        json!({
            "model_provider": "relay",
            "model_providers": {"relay": {"base_url": "https://relay.example/v1"}}
        }),
        json!({"account": null, "requiresOpenaiAuth": false}),
    )
    .await;

    assert_eq!(status["mode"], "custom");
    assert_eq!(status["customBaseUrl"], "https://relay.example/v1");
    assert_eq!(status["state"], "connected");
}

#[tokio::test]
async fn provider_connection_should_detect_openai_base_url_override() {
    let status = read_provider_connection(
        json!({
            "model_provider": "openai",
            "openai_base_url": "https://relay.example/v1"
        }),
        json!({"account": {"type": "apiKey"}, "requiresOpenaiAuth": true}),
    )
    .await;

    assert_eq!(status["mode"], "custom");
    assert_eq!(status["customBaseUrl"], "https://relay.example/v1");
    assert_eq!(status["state"], "connected");
}
