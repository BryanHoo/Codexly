use super::{AppServerConnection, reconcile_official_plugins};
use serde_json::{Value, json};
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, duplex, split};

#[tokio::test]
async fn plugin_reconcile_should_share_pending_pass_and_preserve_partial_failures() {
    let (client, server) = duplex(16 * 1024);
    let (reader, writer) = split(client);
    let connection = Arc::new(AppServerConnection::new(reader, writer));
    let (reader, mut writer) = split(server);
    let server = tokio::spawn(async move {
        let mut lines = BufReader::new(reader).lines();
        for _ in 0..2 {
            let request: Value =
                serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
            assert_eq!(request["method"], "plugin/reconcile");
            assert_eq!(request["params"], json!({"reason": "codexly.refresh"}));
            writer.write_all(format!("{}\n", json!({"id": request["id"], "result": {
                "changedPlugins": [{"id": "github@remote", "hasApps": true, "hasHooks": false, "hasMcps": true, "hasSkills": false}],
                "failedRemotePluginIds": ["failed"], "failedMaterializationRemotePluginIds": ["failed"],
                "privateMetadata": "omit"
            }})).as_bytes()).await.unwrap();
        }
    });
    let (first, second) = tokio::join!(
        reconcile_official_plugins(Arc::clone(&connection)),
        reconcile_official_plugins(Arc::clone(&connection)),
    );
    let first = serde_json::to_value(first.unwrap()).unwrap();
    assert_eq!(first, serde_json::to_value(second.unwrap()).unwrap());
    assert_eq!(first["failedRemotePluginIds"], json!(["failed"]));
    assert!(first.get("privateMetadata").is_none());
    reconcile_official_plugins(connection).await.unwrap();
    server.await.unwrap();
}

#[tokio::test]
async fn plugin_reconcile_should_reject_invalid_result_and_allow_retry() {
    let (client, server) = duplex(16 * 1024);
    let (reader, writer) = split(client);
    let connection = Arc::new(AppServerConnection::new(reader, writer));
    let (reader, mut writer) = split(server);
    let server = tokio::spawn(async move {
        let mut lines = BufReader::new(reader).lines();
        for result in [
            json!({}),
            json!({"changedPlugins": [], "failedRemotePluginIds": [], "failedMaterializationRemotePluginIds": []}),
        ] {
            let request: Value =
                serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
            writer
                .write_all(
                    format!("{}\n", json!({"id": request["id"], "result": result})).as_bytes(),
                )
                .await
                .unwrap();
        }
    });
    assert!(
        reconcile_official_plugins(Arc::clone(&connection))
            .await
            .is_err()
    );
    assert!(reconcile_official_plugins(connection).await.is_ok());
    server.await.unwrap();
}
