use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};

use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, duplex, split};

use super::{AppServerConnection, catalogs::list_models};

#[tokio::test]
async fn restored_window_should_reuse_models_from_the_background_connection() {
    let (client, server) = duplex(32 * 1024);
    let (reader, writer) = split(client);
    let connection = AppServerConnection::new(reader, writer);
    let (reader, mut writer) = split(server);
    let requests = Arc::new(AtomicUsize::new(0));
    let recorded = Arc::clone(&requests);
    let server_task = tokio::spawn(async move {
        let mut lines = BufReader::new(reader).lines();
        while let Some(line) = lines.next_line().await.unwrap() {
            let request: Value = serde_json::from_str(&line).unwrap();
            recorded.fetch_add(1, Ordering::Relaxed);
            let response = json!({"id": request["id"], "result": {"data": [], "nextCursor": null}});
            writer
                .write_all(format!("{response}\n").as_bytes())
                .await
                .unwrap();
        }
    });

    let first = list_models(&connection).await.unwrap();
    assert_eq!(list_models(&connection).await.unwrap(), first);
    assert_eq!(requests.load(Ordering::Relaxed), 1);
    server_task.abort();
}
