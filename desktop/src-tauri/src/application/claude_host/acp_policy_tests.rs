use super::transport::*;
use serde_json::json;
use std::{sync::Arc, time::Duration};
use tokio::{
    io::{AsyncBufReadExt, BufReader},
    time::{Instant, timeout},
};

#[tokio::test]
async fn active_acp_turns_should_keep_the_engine_for_disconnect_delivery() {
    let (transport, _writes) = Transport::new();
    let (catalog, _catalog_receiver) = tokio::sync::mpsc::channel(4);
    let (lane, _lane_receiver) = tokio::sync::mpsc::channel(4);
    let input = ["codex","claude"].map(|engine| format!("{}\n",json!({"projectId":"p","event":{"provider":engine,"type":"turn.started","taskId":engine,"turnId":"turn","payload":{}}}))).join("");
    reader_loop(
        input.as_bytes(),
        Arc::clone(&transport),
        catalog,
        vec![lane],
    )
    .await;
    let active = transport.active_turns.lock().unwrap();
    let active = serde_json::to_value(&*active).unwrap();
    assert_eq!(active["codex"][2], "codex");
    assert_eq!(active["claude"][2], "claude");
}
#[tokio::test]
async fn cancelled_acp_read_should_keep_the_host_and_forward_cancel_id() {
    let (transport, writes) = Transport::new();
    let (writer, reader) = tokio::io::duplex(4096);
    let worker = tokio::spawn(writer_loop(writer, writes, Arc::clone(&transport)));
    let pending = Arc::clone(&transport);
    let request = tokio::spawn(async move {
        pending
            .request_acp(
                "task.read",
                None,
                json!({"taskId":"t"}),
                Instant::now() + Duration::from_secs(2),
            )
            .await
    });
    let mut lines = BufReader::new(reader).lines();
    let frame: serde_json::Value =
        serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
    request.abort();
    let _ = request.await;
    let cancel = timeout(Duration::from_secs(1), lines.next_line())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&cancel).unwrap()["cancelId"],
        frame["id"]
    );
    assert!(!transport.stopped.is_cancelled());
    worker.abort();
    let _ = worker.await;
}
