use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, duplex, split};

use super::AppServerConnection;

#[tokio::test]
async fn overloaded_requests_should_retry_with_new_request_ids() {
    let (client, server) = duplex(8 * 1024);
    let (client_reader, client_writer) = split(client);
    let (server_reader, mut server_writer) = split(server);
    let connection = AppServerConnection::new(client_reader, client_writer);
    let server_task = tokio::spawn(async move {
        let mut lines = BufReader::new(server_reader).lines();
        let mut ids = Vec::new();
        for attempt in 0..3 {
            let request: Value = serde_json::from_str(&lines.next_line().await.unwrap().unwrap())
                .expect("request should be JSON");
            ids.push(request["id"].as_u64().unwrap());
            let frame = if attempt < 2 {
                json!({
                    "id": request["id"].clone(),
                    "error": {"code": -32001, "message": "Server overloaded; retry later."}
                })
            } else {
                json!({"id": request["id"].clone(), "result": {"ok": true}})
            };
            server_writer
                .write_all(format!("{frame}\n").as_bytes())
                .await
                .unwrap();
        }
        assert_eq!(ids, vec![1, 2, 3]);
    });

    let response: Value = connection
        .request("model/list", &json!({}), std::time::Duration::from_secs(1))
        .await
        .expect("overloaded request should recover");
    assert_eq!(response, json!({"ok": true}));
    server_task.await.unwrap();
}
