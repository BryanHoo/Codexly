use super::super::{transport::*, workers::catalog_loop};
use crate::infrastructure::local_catalog::LocalCatalog;
use serde_json::json;
use std::{sync::Arc, time::Duration};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    sync::mpsc,
    time::{Instant, timeout},
};

#[tokio::test]
async fn model_preview_should_read_project_through_catalog_bridge() {
    let directory = tempfile::tempdir().unwrap();
    let catalog = LocalCatalog::at(directory.path()).unwrap();
    catalog
        .call(
            "project.put",
            json!({"id":"p","name":"test","path":"/workspace","createdAt":"2026-10-17"}),
        )
        .await
        .unwrap();
    let (transport, writes) = Transport::new();
    let (writer, reader) = tokio::io::duplex(4096);
    let writer = tokio::spawn(writer_loop(writer, writes, Arc::clone(&transport)));
    let (sender, receiver) = mpsc::channel(1);
    let worker = tokio::spawn(catalog_loop(receiver, catalog, Arc::clone(&transport)));
    sender
        .send(Routed {
            message: json!({"catalogId":1,"operation":"project.read","payload":{"id":"p"}}),
            _budget: Arc::clone(&transport.inbound_budget)
                .acquire_owned()
                .await
                .unwrap(),
        })
        .await
        .unwrap();
    let reply = BufReader::new(reader)
        .lines()
        .next_line()
        .await
        .unwrap()
        .unwrap();
    let frame: serde_json::Value = serde_json::from_str(&reply).unwrap();
    assert_eq!(frame["result"]["path"], "/workspace", "{frame}");
    drop(sender);
    worker.await.unwrap();
    writer.abort();
}

#[tokio::test]
async fn real_slow_catalog_write_should_not_delay_response_delivery() {
    let directory = tempfile::tempdir().unwrap();
    let catalog = LocalCatalog::at(directory.path()).unwrap();
    catalog
        .call(
            "project.put",
            json!({"id":"p","name":"test","path":"/workspace","createdAt":"2026-10-17"}),
        )
        .await
        .unwrap();
    let database = rusqlite::Connection::open(directory.path().join("state.sqlite3")).unwrap();
    database.execute_batch("BEGIN IMMEDIATE").unwrap();
    let (transport, writes) = Transport::new();
    let (writer, mut peer) = tokio::io::duplex(4096);
    let writer_task = tokio::spawn(writer_loop(writer, writes, Arc::clone(&transport)));
    let pending = Arc::clone(&transport);
    let request = tokio::spawn(async move {
        pending
            .request_acp(
                "test",
                None,
                json!({}),
                Instant::now() + Duration::from_secs(1),
            )
            .await
    });
    let mut buf = [0; 4096];
    let size = peer.read(&mut buf).await.unwrap();
    let id = serde_json::from_slice::<serde_json::Value>(&buf[..size]).unwrap()["id"].clone();
    let (catalog_sender, catalog_receiver) = mpsc::channel(64);
    let worker = tokio::spawn(catalog_loop(
        catalog_receiver,
        catalog,
        Arc::clone(&transport),
    ));
    let (lane, _events) = mpsc::channel(64);
    let (reader, mut output) = tokio::io::duplex(4096);
    let reader_task = tokio::spawn(reader_loop(
        reader,
        Arc::clone(&transport),
        catalog_sender,
        vec![lane],
    ));
    output
        .write_all(
            format!(
                "{}\n",
                json!({"catalogId":1,"operation":"task.remove","payload":{"id":"missing"}})
            )
            .as_bytes(),
        )
        .await
        .unwrap();
    tokio::time::sleep(Duration::from_millis(30)).await;
    output
        .write_all(format!("{}\n", json!({"id":id,"result":"ready"})).as_bytes())
        .await
        .unwrap();
    let result = timeout(Duration::from_millis(200), request).await;
    database.execute_batch("COMMIT").unwrap();
    assert_eq!(result.unwrap().unwrap().unwrap(), json!("ready"));
    // 等待实际数据库 worker 的写回后再清理，确保没有遗留的阻塞任务持有 SQLite。
    assert!(
        timeout(Duration::from_secs(1), peer.read(&mut buf))
            .await
            .unwrap()
            .unwrap()
            > 0
    );
    worker.abort();
    reader_task.abort();
    writer_task.abort();
}
