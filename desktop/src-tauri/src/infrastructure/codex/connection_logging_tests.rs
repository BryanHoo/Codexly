use super::*;
use crate::infrastructure::diagnostics::test_support::Capture;
use serde_json::{Value, json};
use tokio::io::duplex;

#[tokio::test]
async fn diagnostic_timeout_records_correlation_budget_and_wait_phase() {
    let capture = Capture::start();
    let (reader, _server) = duplex(1024);
    let connection = AppServerConnection::new(reader, tokio::io::sink());
    let _lock = connection.writer.lock().await;
    let result = connection
        .request::<_, Value>("turn/start", &(), Duration::from_millis(10))
        .await;
    assert!(matches!(result, Err(ConnectionError::Timeout)));
    let events = capture.take();
    let started = events
        .iter()
        .find(|event| event["event"] == "codex_rpc_request_started")
        .unwrap();
    let failed = events
        .iter()
        .find(|event| event["event"] == "codex_rpc_request_failed")
        .unwrap();
    for key in ["connectionSeq", "operationSeq"] {
        assert!(started["context"][key].is_u64());
        assert_eq!(started["context"][key], failed["context"][key]);
    }
    assert_eq!(failed["context"]["phase"], json!("write_queue"));
    assert_eq!(failed["context"]["timeoutMs"], json!(10));
    assert_eq!(failed["context"]["requestSeq"], json!(1));
}

#[tokio::test]
async fn diagnostic_cancelled_key_request_has_a_terminal_event() {
    let capture = Capture::start();
    let (reader, _server) = duplex(1024);
    let connection = AppServerConnection::new(reader, tokio::io::sink());
    let mut request =
        Box::pin(connection.request::<_, Value>("turn/start", &(), Duration::from_secs(1)));
    std::future::poll_fn(|cx| {
        assert!(request.as_mut().poll(cx).is_pending());
        std::task::Poll::Ready(())
    })
    .await;
    drop(request);
    let events = capture.take();
    let cancelled = events
        .iter()
        .find(|event| event["event"] == "codex_rpc_request_cancelled")
        .unwrap();
    assert_eq!(cancelled["context"]["phase"], json!("response"));
    assert_eq!(cancelled["level"], json!("info"));
}

#[tokio::test]
async fn diagnostic_invalid_frame_records_cause_without_payload() {
    let capture = Capture::start();
    let (reader, mut server) = duplex(1024);
    let connection = AppServerConnection::new(reader, tokio::io::sink());
    server
        .write_all(b"private-invalid-payload\n")
        .await
        .unwrap();
    let _ = connection
        .request::<_, Value>("thread/read", &(), Duration::from_secs(1))
        .await;
    let events = capture.take();
    let closed = events
        .iter()
        .find(|event| event["event"] == "codex_connection_read_failed")
        .unwrap();
    assert_eq!(closed["context"]["reason"], json!("invalid_json"));
    assert!(closed["context"]["connectionSeq"].is_u64());
    assert!(
        !serde_json::to_string(&events)
            .unwrap()
            .contains("private-invalid-payload")
    );
}

#[tokio::test]
async fn diagnostic_retry_keeps_operation_scope_and_reports_last_wire_request() {
    let capture = Capture::start();
    let (client, server) = duplex(4096);
    let (reader, writer) = tokio::io::split(client);
    let connection = AppServerConnection::new(reader, writer);
    let responder = tokio::spawn(async move {
        let mut server = BufReader::new(server);
        for code in [Some(-32001), None] {
            let mut line = String::new();
            server.read_line(&mut line).await.unwrap();
            let request: Value = serde_json::from_str(&line).unwrap();
            let response = match code {
                Some(code) => json!({"id":request["id"], "error":{"code":code,"message":"busy"}}),
                None => json!({"id":request["id"], "result":{}}),
            };
            server
                .get_mut()
                .write_all(format!("{response}\n").as_bytes())
                .await
                .unwrap();
        }
        // 保持连接直到断言完成，避免测试自行关闭触发 EOF 日志。
        server
    });
    connection
        .request::<_, Value>("turn/start", &(), Duration::from_secs(1))
        .await
        .unwrap();
    let _server = responder.await.unwrap();
    let events = capture.take();
    let started = events
        .iter()
        .find(|event| event["event"] == "codex_rpc_request_started")
        .unwrap();
    let recovered = events
        .iter()
        .find(|event| event["event"] == "codex_rpc_request_recovered")
        .unwrap();
    assert_eq!(
        started["context"]["operationSeq"],
        recovered["context"]["operationSeq"]
    );
    assert_eq!(recovered["context"]["requestSeq"], json!(2));
    assert_eq!(recovered["context"]["retryCount"], json!(1));
    assert_eq!(events.len(), 2);
}
