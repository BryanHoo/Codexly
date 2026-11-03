use super::*;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, duplex, split};

#[tokio::test]
async fn lifecycle_should_call_native_before_committing_catalog() {
    for method in ["thread/archive", "thread/unarchive", "thread/delete"] {
        // 使用真实目录仓储和 JSONL 传输，原生响应前目录必须保持原状。
        let dir = tempfile::tempdir().unwrap();
        let (client, server) = duplex(8192);
        let (reader, writer) = split(client);
        let connection = AppServerConnection::with_image_store(reader, writer, dir.path());
        let catalog = connection.catalog.as_ref().unwrap().clone();
        let before = json!({"id":"task-local","projectId":null,"title":"任务","cwd":"/work",
            "provider":"codex","sessionId":"native","updatedAt":100,"pinned":false,
            "archived":method=="thread/unarchive","status":"idle"});
        catalog.call("task.put", before).await.unwrap();
        let original = catalog
            .call("task.read", json!({"id":"task-local"}))
            .await
            .unwrap();
        let server_catalog = catalog.clone();
        let server_task = tokio::spawn(async move {
            let (reader, mut writer) = split(server);
            let mut lines = BufReader::new(reader).lines();
            let line = tokio::time::timeout(Duration::from_millis(500), lines.next_line())
                .await
                .expect("生命周期必须调用原生 RPC")
                .unwrap()
                .unwrap();
            let request: Value = serde_json::from_str(&line).unwrap();
            assert_eq!(request["method"], method);
            assert_eq!(request["params"], json!({"threadId":"native"}));
            assert_eq!(
                server_catalog
                    .call("task.read", json!({"id":"task-local"}))
                    .await
                    .unwrap(),
                original
            );
            writer
                .write_all(
                    format!(
                        "{}\n",
                        json!({"id":request["id"],"result":{"thread":{"id":"native"}}})
                    )
                    .as_bytes(),
                )
                .await
                .unwrap();
        });
        let result: Result<Value, _> = connection
            .request(
                method,
                &json!({"threadId":"task-local"}),
                Duration::from_secs(2),
            )
            .await;
        server_task.await.unwrap();
        result.unwrap();
        let after = catalog
            .call("task.read", json!({"id":"task-local"}))
            .await
            .unwrap();
        if method == "thread/delete" {
            assert!(after.is_null());
        } else {
            assert_eq!(after["archived"], method == "thread/archive");
        }
    }
}

#[tokio::test]
async fn lifecycle_should_preserve_catalog_unless_native_method_is_unsupported() {
    for method in ["thread/archive", "thread/unarchive", "thread/delete"] {
        for code in [-32601, -32600, -32603] {
            let dir = tempfile::tempdir().unwrap();
            let (client, server) = duplex(8192);
            let (reader, writer) = split(client);
            let connection = AppServerConnection::with_image_store(reader, writer, dir.path());
            let catalog = connection.catalog.as_ref().unwrap();
            catalog
                .call(
                    "task.put",
                    json!({"id":"task-local","projectId":null,"title":"任务","cwd":"/work",
                "provider":"codex","sessionId":"native","updatedAt":100,"pinned":false,
                "archived":method=="thread/unarchive","status":"idle"}),
                )
                .await
                .unwrap();
            let before = catalog
                .call("task.read", json!({"id":"task-local"}))
                .await
                .unwrap();
            let server_task = tokio::spawn(async move {
                let (reader, mut writer) = split(server);
                let mut lines = BufReader::new(reader).lines();
                let line = tokio::time::timeout(Duration::from_millis(500), lines.next_line())
                    .await
                    .unwrap()
                    .unwrap()
                    .unwrap();
                let request: Value = serde_json::from_str(&line).unwrap();
                writer.write_all(format!("{}\n", json!({"id":request["id"],"error":{"code":code,"message":"native failure"}})).as_bytes()).await.unwrap();
            });
            let result: Result<Value, _> = connection
                .request(
                    method,
                    &json!({"threadId":"task-local"}),
                    Duration::from_secs(2),
                )
                .await;
            server_task.await.unwrap();
            assert_eq!(result.is_ok(), code == -32601);
            let after = catalog
                .call("task.read", json!({"id":"task-local"}))
                .await
                .unwrap();
            if code != -32601 {
                assert_eq!(before, after);
            }
        }
    }
}

#[tokio::test]
async fn lifecycle_should_finish_deleted_sessions_and_verify_legacy_archives() {
    for (method, message, readable) in [
        ("thread/delete", "thread not found: native", true),
        (
            "thread/delete",
            "no rollout found for thread id native",
            true,
        ),
        (
            "thread/unarchive",
            "no archived rollout found for thread id native",
            true,
        ),
        (
            "thread/unarchive",
            "no archived rollout found for thread id native",
            false,
        ),
    ] {
        let dir = tempfile::tempdir().unwrap();
        let (client, server) = duplex(8192);
        let (reader, writer) = split(client);
        let connection = AppServerConnection::with_image_store(reader, writer, dir.path());
        let catalog = connection.catalog.as_ref().unwrap();
        catalog
            .call(
                "task.put",
                json!({"id":"task-local","projectId":null,"title":"任务","cwd":"/work",
            "provider":"codex","sessionId":"native","updatedAt":100,"pinned":false,
            "archived":true,"status":"idle"}),
            )
            .await
            .unwrap();
        let server_task = tokio::spawn(async move {
            let (reader, mut writer) = split(server);
            let mut lines = BufReader::new(reader).lines();
            let request: Value =
                serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
            writer
                .write_all(
                    format!(
                        "{}\n",
                        json!({"id":request["id"],"error":{"code":-32600,"message":message}})
                    )
                    .as_bytes(),
                )
                .await
                .unwrap();
            if method == "thread/unarchive" {
                let read: Value =
                    serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
                assert_eq!(read["method"], "thread/read");
                assert_eq!(
                    read["params"],
                    json!({"threadId":"native","includeTurns":false})
                );
                let response = if readable {
                    json!({"id":read["id"],"result":{"thread":{"id":"native"}}})
                } else {
                    json!({"id":read["id"],"error":{"code":-32603,"message":"read failed"}})
                };
                writer
                    .write_all(format!("{response}\n").as_bytes())
                    .await
                    .unwrap();
            }
        });
        let result: Result<Value, _> = connection
            .request(
                method,
                &json!({"threadId":"task-local"}),
                Duration::from_secs(2),
            )
            .await;
        server_task.await.unwrap();
        assert_eq!(result.is_ok(), readable);
        let after = catalog
            .call("task.read", json!({"id":"task-local"}))
            .await
            .unwrap();
        if method == "thread/delete" {
            assert!(after.is_null());
        } else {
            assert_eq!(after["archived"], !readable);
        }
    }
}
