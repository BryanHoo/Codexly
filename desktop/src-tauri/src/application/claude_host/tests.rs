use super::transport::*;
use serde_json::json;
use std::{sync::Arc, time::Duration};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    sync::mpsc,
    time::{Instant, timeout},
};

fn routes() -> (
    mpsc::Sender<Routed>,
    mpsc::Receiver<Routed>,
    Vec<mpsc::Sender<Routed>>,
    mpsc::Receiver<Routed>,
) {
    let (catalog, catalogs) = mpsc::channel(64);
    let (lane, events) = mpsc::channel(64);
    (catalog, catalogs, vec![lane], events)
}

#[tokio::test]
async fn stopped_stdin_reader_should_not_bypass_total_request_timeout() {
    let (transport, writes) = Transport::new();
    let (writer, _paused_reader) = tokio::io::duplex(64);
    let worker = tokio::spawn(writer_loop(writer, writes, Arc::clone(&transport)));
    let start = Instant::now();
    let result = timeout(
        Duration::from_secs(1),
        transport.request(
            "test",
            None,
            json!({"text":"x".repeat(1024)}),
            start + Duration::from_millis(50),
        ),
    )
    .await;
    assert!(result.unwrap().is_err());
    assert!(transport.stopped.is_cancelled());
    assert!(start.elapsed() < Duration::from_secs(1));
    worker.await.unwrap();
}

#[cfg(unix)]
#[tokio::test]
async fn real_child_with_paused_stdin_should_respect_deadline_and_be_reaped() {
    use std::process::Stdio;
    use tokio::process::Command;
    // exec 避免 shell 留下孤立 sleep；真实 OS 管道容量远小于请求帧。
    let mut child = Command::new("sh")
        .args(["-c", "exec sleep 60"])
        .stdin(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .unwrap();
    let (transport, writes) = Transport::new();
    let worker = tokio::spawn(writer_loop(
        child.stdin.take().unwrap(),
        writes,
        Arc::clone(&transport),
    ));
    let result = timeout(
        Duration::from_secs(2),
        transport.request(
            "test",
            None,
            json!({"text":"x".repeat(1024 * 1024)}),
            Instant::now() + Duration::from_millis(100),
        ),
    )
    .await;
    assert!(result.unwrap().is_err());
    assert!(transport.stopped.is_cancelled());
    child.kill().await.unwrap();
    assert!(child.try_wait().unwrap().is_some());
    worker.await.unwrap();
}

#[tokio::test]
async fn slow_catalog_and_event_consumer_should_not_block_other_responses() {
    let (transport, writes) = Transport::new();
    let (writer, mut peer) = tokio::io::duplex(4096);
    let writer_task = tokio::spawn(writer_loop(writer, writes, Arc::clone(&transport)));
    let pending = Arc::clone(&transport);
    let request = tokio::spawn(async move {
        pending
            .request(
                "test",
                None,
                json!({}),
                Instant::now() + Duration::from_secs(1),
            )
            .await
    });
    let mut request_bytes = vec![0; 4096];
    let count = peer.read(&mut request_bytes).await.unwrap();
    let id =
        serde_json::from_slice::<serde_json::Value>(&request_bytes[..count]).unwrap()["id"].clone();
    let (catalog, _slow_catalog, lanes, _slow_events) = routes();
    let (reader, mut output) = tokio::io::duplex(4096);
    let reader_task = tokio::spawn(reader_loop(reader, Arc::clone(&transport), catalog, lanes));
    // 不消费两个工作队列，reader 仍须交付独立响应。
    output
        .write_all(
            format!(
                "{}\n{}\n{}\n",
                json!({"catalogId":1,"operation":"task.read","payload":{}}),
                json!({"projectId":"p","event":{"type":"turn.started","taskId":"t","turnId":"r"}}),
                json!({"id":id,"result":"delivered"})
            )
            .as_bytes(),
        )
        .await
        .unwrap();
    assert_eq!(
        timeout(Duration::from_millis(200), request)
            .await
            .unwrap()
            .unwrap()
            .unwrap(),
        json!("delivered")
    );
    reader_task.abort();
    writer_task.abort();
}

#[tokio::test]
async fn bad_frames_should_atomically_disconnect_and_wake_pending_requests() {
    for frame in [
        b"not json\n".to_vec(),
        b"{}\n".to_vec(),
        b"{\"id\":1}".to_vec(),
        vec![b'x'; MAX_FRAME + 1],
    ] {
        let (transport, writes) = Transport::new();
        let (writer, mut peer) = tokio::io::duplex(4096);
        let writer_task = tokio::spawn(writer_loop(writer, writes, Arc::clone(&transport)));
        let pending = Arc::clone(&transport);
        let request = tokio::spawn(async move {
            pending
                .request(
                    "test",
                    None,
                    json!({}),
                    Instant::now() + Duration::from_secs(2),
                )
                .await
        });
        let mut buf = [0; 4096];
        assert!(peer.read(&mut buf).await.unwrap() > 0);
        let (catalog, _catalogs, lanes, _events) = routes();
        reader_loop(frame.as_slice(), Arc::clone(&transport), catalog, lanes).await;
        assert!(transport.stopped.is_cancelled());
        assert!(
            timeout(Duration::from_millis(200), request)
                .await
                .unwrap()
                .unwrap()
                .is_err()
        );
        assert!(
            transport
                .request(
                    "again",
                    None,
                    json!({}),
                    Instant::now() + Duration::from_secs(1)
                )
                .await
                .is_err()
        );
        writer_task.abort();
    }
}

#[tokio::test]
async fn queued_events_and_snapshots_should_preserve_barriers_and_bound_memory() {
    let (transport, _writes) = Transport::new();
    let (catalog, _catalogs, lanes, mut events) = routes();
    let frames = format!(
        "{}\n{}\n{}\n",
        json!({"projectId":"p","event":{"type":"message.delta"}}),
        json!({"id":1,"snapshotProjectId":"p","result":{}}),
        json!({"projectId":"p","event":{"type":"turn.completed"}})
    );
    reader_loop(frames.as_bytes(), Arc::clone(&transport), catalog, lanes).await;
    assert_eq!(
        events.recv().await.unwrap().message["event"]["type"],
        "message.delta"
    );
    assert_eq!(
        events.recv().await.unwrap().message["snapshotProjectId"],
        "p"
    );
    assert_eq!(
        events.recv().await.unwrap().message["event"]["type"],
        "turn.completed"
    );
    assert_eq!(transport.inbound_budget.available_permits(), QUEUE_BYTES);

    let (transport, _writes) = Transport::new();
    let (catalog, _catalogs, lanes, paused_events) = routes();
    let frame = format!(
        "{}\n",
        json!({"projectId":"p","event":{"type":"message.delta","payload":{"delta":"x".repeat(1024 * 1024)}}})
    );
    reader_loop(
        frame.repeat(20).as_bytes(),
        Arc::clone(&transport),
        catalog,
        lanes,
    )
    .await;
    assert!(transport.stopped.is_cancelled());
    assert_eq!(paused_events.len(), QUEUE_BYTES / frame.len());
    assert_eq!(
        transport.inbound_budget.available_permits(),
        QUEUE_BYTES % frame.len()
    );
}

#[tokio::test]
async fn broken_pipe_should_wake_requests_and_allow_a_fresh_transport() {
    let (transport, writes) = Transport::new();
    let (writer, peer) = tokio::io::duplex(64);
    drop(peer);
    let worker = tokio::spawn(writer_loop(writer, writes, Arc::clone(&transport)));
    assert!(
        transport
            .request(
                "test",
                None,
                json!({}),
                Instant::now() + Duration::from_secs(1)
            )
            .await
            .is_err()
    );
    assert!(transport.stopped.is_cancelled());
    worker.await.unwrap();
    let (fresh, writes) = Transport::new();
    let (writer, mut peer) = tokio::io::duplex(4096);
    let worker = tokio::spawn(writer_loop(writer, writes, Arc::clone(&fresh)));
    let pending = Arc::clone(&fresh);
    let request = tokio::spawn(async move {
        pending
            .request(
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
    fresh.respond(json!({"id":id,"result":"recovered"}));
    assert_eq!(request.await.unwrap().unwrap(), json!("recovered"));
    worker.abort();
}

#[tokio::test]
async fn deadline_should_include_queue_wait_and_cancelled_requests_should_release_capacity() {
    let (transport, mut writes) = Transport::new();
    for _ in 0..40 {
        let pending = Arc::clone(&transport);
        let request = tokio::spawn(async move {
            pending
                .request(
                    "test",
                    None,
                    json!({}),
                    Instant::now() + Duration::from_secs(1),
                )
                .await
        });
        let queued = timeout(Duration::from_millis(200), writes.recv())
            .await
            .unwrap()
            .unwrap();
        request.abort();
        let _ = request.await;
        drop(queued);
    }
    // writer 无消费者：超时也覆盖实际写入之前的队列等待。
    let result = timeout(
        Duration::from_secs(1),
        transport.request(
            "queued",
            None,
            json!({}),
            Instant::now() + Duration::from_millis(30),
        ),
    )
    .await;
    assert!(result.unwrap().is_err());
    assert!(transport.stopped.is_cancelled());
}

#[tokio::test]
async fn real_slow_catalog_write_should_not_delay_response_delivery() {
    use crate::infrastructure::local_catalog::LocalCatalog;
    let directory = tempfile::tempdir().unwrap();
    let catalog = LocalCatalog::at(directory.path()).unwrap();
    catalog
        .call(
            "project.put",
            json!({"id":"p","name":"test","path":"/workspace","createdAt":"2026-10-17"}),
        )
        .await
        .unwrap();
    let database = rusqlite::Connection::open(directory.path().join("catalog.sqlite3")).unwrap();
    database.execute_batch("BEGIN IMMEDIATE").unwrap();
    let (transport, writes) = Transport::new();
    let (writer, mut peer) = tokio::io::duplex(4096);
    let writer_task = tokio::spawn(writer_loop(writer, writes, Arc::clone(&transport)));
    let pending = Arc::clone(&transport);
    let request = tokio::spawn(async move {
        pending
            .request(
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
    let worker = tokio::spawn(super::workers::catalog_loop(
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
