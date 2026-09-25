use std::{
    fs,
    sync::atomic::{AtomicU64, Ordering},
};

use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, duplex, split};

use crate::infrastructure::provider_models::{read_provider_models, write_provider_models};

use super::{
    AppServerConnection, configure_custom_provider, list_provider_models,
    start_official_provider_login,
};

static TEST_ROOT_ID: AtomicU64 = AtomicU64::new(1);

fn test_root() -> std::path::PathBuf {
    let id = TEST_ROOT_ID.fetch_add(1, Ordering::Relaxed);
    std::env::temp_dir().join(format!("codeagent-auth-{}-{id}", std::process::id()))
}

#[tokio::test]
async fn custom_provider_models_should_prefer_live_catalog_to_persisted_data() {
    let root = test_root();
    let stored_models = json!({
        "data": [{"displayName": "Custom A", "id": "custom-a"}],
        "nextCursor": null,
    });
    write_provider_models(&root, "relay", "https://relay.example/v1", &stored_models)
        .await
        .unwrap();
    let (client, server) = duplex(32 * 1024);
    let (client_reader, client_writer) = split(client);
    let (server_reader, mut server_writer) = split(server);
    let connection = AppServerConnection::new(client_reader, client_writer);

    let server_task = tokio::spawn(async move {
        let mut lines = BufReader::new(server_reader).lines();
        let request: Value =
            serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
        assert_eq!(request["method"], "config/read");
        server_writer
            .write_all(
                format!(
                    "{}\n",
                    json!({
                        "id": request["id"].clone(),
                        "result": {
                            "config": {
                                "model_provider": "relay",
                                "model_providers": {
                                    "relay": {"base_url": "https://relay.example/v1"}
                                }
                            }
                        }
                    })
                )
                .as_bytes(),
            )
            .await
            .unwrap();
        let request: Value =
            serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
        assert_eq!(request["method"], "model/list");
        server_writer.write_all(format!("{}\n", json!({
            "id": request["id"], "result": {"data": [{
                "id": "online-a", "displayName": "Online A", "defaultReasoningEffort": "none",
                "supportedReasoningEfforts": [{"reasoningEffort": "none", "description": "None"}]
            }], "nextCursor": null}
        })).as_bytes()).await.unwrap();
    });

    let models = list_provider_models(&connection, &root).await.unwrap();
    assert_eq!(models["data"][0]["id"], "online-a");
    assert_eq!(
        models["data"][0]["supportedReasoningEfforts"][0]["id"],
        "low"
    );
    assert_eq!(
        models["data"][0]["supportedReasoningEfforts"]
            .as_array()
            .unwrap()
            .len(),
        3
    );
    assert_eq!(
        read_provider_models(&root, "relay", "https://relay.example/v1")
            .await
            .unwrap(),
        Some(models)
    );
    server_task.await.unwrap();
    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn empty_custom_provider_models_should_fall_back_to_codex_catalog() {
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
                                "model_provider": "relay",
                                "model_providers": {
                                    "relay": {"base_url": "https://relay.example/v1"}
                                }
                            }
                        }
                    })
                )
                .as_bytes(),
            )
            .await
            .unwrap();

        let model_list: Value =
            serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
        assert_eq!(model_list["method"], "model/list");
        server_writer
            .write_all(
                format!(
                    "{}\n",
                    json!({
                        "id": model_list["id"].clone(),
                        "result": {
                            "data": [{
                                "defaultReasoningEffort": "medium",
                                "description": "Codex model",
                                "displayName": "GPT Test",
                                "id": "gpt-test",
                                "isDefault": true,
                                "supportedReasoningEfforts": [{
                                    "description": "Medium",
                                    "reasoningEffort": "medium"
                                }]
                            }],
                            "nextCursor": null
                        }
                    })
                )
                .as_bytes(),
            )
            .await
            .unwrap();
    });

    let models = list_provider_models(&connection, &root).await.unwrap();
    assert_eq!(models["data"][0]["id"], "gpt-test");
    server_task.await.unwrap();
}

#[tokio::test]
async fn custom_provider_reconnect_should_keep_persisted_models_when_omitted() {
    let root = test_root();
    let stored_models = json!({
        "data": [{
            "defaultReasoningEffort": "medium",
            "description": "Custom provider model",
            "displayName": "Custom A",
            "id": "custom-a",
            "isDefault": true,
            "supportedReasoningEfforts": [{"description": "Medium", "id": "medium"}]
        }],
        "nextCursor": null,
    });
    let legacy_models = stored_models.clone();
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
                                "desktop": {
                                    "codeagent": {
                                        "provider": {
                                            "customBaseUrl": "https://api.example/v1",
                                            "customModels": legacy_models["data"]
                                        }
                                    }
                                },
                                "model_provider": "relay",
                                "model_providers": {
                                    "relay": {"base_url": "https://api.example/v1"}
                                }
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
        assert_eq!(config_write["method"], "config/batchWrite");
        let edits = config_write["params"]["edits"].as_array().unwrap();
        assert!(
            edits
                .iter()
                .any(|edit| edit["keyPath"] == "model_providers.relay")
        );
        assert!(edits.iter().all(|edit| edit["keyPath"] != "model_provider"));
        assert!(edits.iter().any(|edit| {
            edit["keyPath"] == "desktop.codeagent.provider" && edit["value"].is_null()
        }));
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

    let response = configure_custom_provider(
        &connection,
        &root,
        json!({"baseUrl": "https://api.example/v1"}),
    )
    .await
    .unwrap();

    assert_eq!(response["models"]["data"][0]["id"], "custom-a");
    server_task.await.unwrap();
    assert_eq!(
        read_provider_models(&root, "relay", "https://api.example/v1")
            .await
            .unwrap(),
        Some(stored_models)
    );
    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn custom_provider_should_default_to_openai_when_provider_is_missing() {
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
                    json!({"id": config_read["id"].clone(), "result": {"config": {}}})
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
                .any(|edit| edit["keyPath"] == "model_providers.OpenAI")
        );
        assert!(
            edits
                .iter()
                .any(|edit| edit["keyPath"] == "features.api_key_model_discovery"
                    && edit["value"] == true)
        );
        assert!(
            edits
                .iter()
                .any(|edit| edit["keyPath"] == "model_providers.OpenAI"
                    && edit["value"]["model_catalog_url"] == "https://api.example/v1/models")
        );
        assert!(
            edits
                .iter()
                .any(|edit| { edit["keyPath"] == "model_provider" && edit["value"] == "OpenAI" })
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
        json!({"baseUrl": "https://api.example/v1"}),
    )
    .await
    .unwrap();
    server_task.await.unwrap();
}

#[tokio::test]
async fn provider_login_should_keep_secrets_out_of_config_payloads() {
    let root = test_root();
    let (client, server) = duplex(32 * 1024);
    let (client_reader, client_writer) = split(client);
    let (server_reader, mut server_writer) = split(server);
    let connection = AppServerConnection::new(client_reader, client_writer);

    let server_task = tokio::spawn(async move {
        let mut lines = BufReader::new(server_reader).lines();
        let official_config: Value =
            serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
        assert_eq!(official_config["method"], "config/batchWrite");
        assert!(
            official_config["params"]["edits"]
                .as_array()
                .is_some_and(|edits| edits.iter().any(|edit| {
                    edit["keyPath"] == "desktop.codeagent.provider" && edit["value"].is_null()
                }))
        );
        assert!(
            official_config["params"]["edits"]
                .as_array()
                .unwrap()
                .iter()
                .any(|edit| edit["keyPath"] == "openai_base_url" && edit["value"].is_null())
        );
        server_writer
            .write_all(
                format!(
                    "{}\n",
                    json!({"id": official_config["id"].clone(), "result": {}})
                )
                .as_bytes(),
            )
            .await
            .unwrap();

        let official_login: Value =
            serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
        assert_eq!(official_login["method"], "account/login/start");
        assert_eq!(official_login["params"]["type"], "chatgpt");
        server_writer.write_all(format!("{}\n", json!({"id": official_login["id"].clone(), "result": {"type": "chatgpt", "loginId": "login-a", "authUrl": "https://auth.example/login"}})).as_bytes()).await.unwrap();

        let custom_config_read: Value =
            serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
        assert_eq!(custom_config_read["method"], "config/read");
        server_writer
            .write_all(
                format!(
                    "{}\n",
                    json!({
                        "id": custom_config_read["id"].clone(),
                        "result": {"config": {"model_provider": "openai"}}
                    })
                )
                .as_bytes(),
            )
            .await
            .unwrap();

        let custom_config: Value =
            serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
        assert_eq!(custom_config["method"], "config/batchWrite");
        assert!(!custom_config.to_string().contains("secret-key"));
        assert!(
            custom_config["params"]["edits"]
                .as_array()
                .is_some_and(|edits| edits.iter().any(|edit| {
                    edit["keyPath"] == "model_provider" && edit["value"] == "OpenAI"
                }))
        );
        let private_edit = custom_config["params"]["edits"]
            .as_array()
            .and_then(|edits| {
                edits
                    .iter()
                    .find(|edit| edit["keyPath"] == "desktop.codeagent.provider")
            })
            .unwrap();
        assert!(private_edit["value"].is_null());
        server_writer
            .write_all(
                format!(
                    "{}\n",
                    json!({"id": custom_config["id"].clone(), "result": {}})
                )
                .as_bytes(),
            )
            .await
            .unwrap();

        let api_login: Value =
            serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
        assert_eq!(api_login["method"], "account/login/start");
        assert_eq!(api_login["params"]["apiKey"], "secret-key");
        server_writer
            .write_all(
                format!(
                    "{}\n",
                    json!({"id": api_login["id"].clone(), "result": {"type": "apiKey"}})
                )
                .as_bytes(),
            )
            .await
            .unwrap();
    });

    let official = start_official_provider_login(&connection).await.unwrap();
    assert_eq!(official["loginId"], "login-a");
    let custom = configure_custom_provider(
        &connection,
        &root,
        json!({"apiKey": "secret-key", "baseUrl": "https://api.example/v1", "models": [{"id": "custom-a", "name": "Custom A"}]}),
    )
    .await
    .unwrap();
    assert_eq!(custom["models"]["data"][0]["id"], "custom-a");
    server_task.await.unwrap();
    assert!(
        read_provider_models(&root, "OpenAI", "https://api.example/v1")
            .await
            .unwrap()
            .is_some()
    );
    fs::remove_dir_all(root).unwrap();
}
