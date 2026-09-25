use std::time::Duration;

use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, duplex, split};

use super::connection::{AppServerConnection, FrameReadError, read_bounded_frame};

#[tokio::test]
async fn bounded_reader_should_reject_oversized_standard_frame() {
    let input = b"{\"value\":\"0123456789\"}\n";
    let mut reader = BufReader::new(input.as_slice());
    let mut frame = Vec::new();

    let result = read_bounded_frame(&mut reader, &mut frame, 16, 64).await;

    assert!(matches!(result, Err(FrameReadError::TooLarge)));
    assert_eq!(frame.len(), 16);
}

#[tokio::test]
async fn bounded_reader_should_accept_standard_frame_at_limit() {
    let input = b"12345678\n";
    let mut reader = BufReader::new(input.as_slice());
    let mut frame = Vec::new();

    assert!(
        read_bounded_frame(&mut reader, &mut frame, 8, 64)
            .await
            .unwrap()
    );
    assert_eq!(frame, b"12345678");
}

#[tokio::test]
async fn bounded_reader_should_apply_image_frame_limit() {
    let input = b"\"imageGeneration\":\"0123456789\"\n";
    let mut reader = BufReader::new(input.as_slice());
    let mut frame = Vec::new();

    assert!(
        read_bounded_frame(&mut reader, &mut frame, 20, 64)
            .await
            .unwrap()
    );
    assert_eq!(frame, &input[..input.len() - 1]);
}

#[tokio::test]
async fn bounded_reader_should_reject_oversized_image_frame() {
    let input = b"\"imageGeneration\":\"0123456789\"\n";
    let mut reader = BufReader::new(input.as_slice());
    let mut frame = Vec::new();

    let result = read_bounded_frame(&mut reader, &mut frame, 20, 24).await;

    assert!(matches!(result, Err(FrameReadError::TooLarge)));
    assert_eq!(frame.len(), 24);
}

#[tokio::test]
async fn initialize_should_complete_required_handshake() {
    let (client, server) = duplex(4096);
    let (client_reader, client_writer) = split(client);
    let (server_reader, mut server_writer) = split(server);
    let connection = AppServerConnection::new(client_reader, client_writer);

    let server_task = tokio::spawn(async move {
        let mut lines = BufReader::new(server_reader).lines();
        let request = lines
            .next_line()
            .await
            .expect("server should read request")
            .expect("initialize request should exist");
        let request: Value = serde_json::from_str(&request).expect("request should be JSON");
        assert_eq!(request["method"], "initialize");
        assert_eq!(request["params"]["clientInfo"]["name"], "codeagent");
        assert_eq!(request["params"]["capabilities"]["experimentalApi"], true);
        let opt_out = request["params"]["capabilities"]["optOutNotificationMethods"]
            .as_array()
            .expect("ignored notifications should be negotiated");
        assert!(opt_out.iter().any(|method| method == "turn/diff/updated"));
        assert!(
            !opt_out
                .iter()
                .any(|method| method == "thread/status/changed")
        );

        server_writer
            .write_all(
                b"{\"id\":1,\"result\":{\"userAgent\":\"codex-cli\",\"codexHome\":\"/tmp/codex\",\"platformFamily\":\"unix\",\"platformOs\":\"macos\"}}\n",
            )
            .await
            .expect("server should write response");

        let notification = lines
            .next_line()
            .await
            .expect("server should read notification")
            .expect("initialized notification should exist");
        assert_eq!(notification, "{\"method\":\"initialized\"}");
    });

    let response = connection
        .initialize(Duration::from_secs(1))
        .await
        .expect("handshake should succeed");

    assert_eq!(response.user_agent, "codex-cli");
    assert_eq!(response.codex_home, "/tmp/codex");
    server_task.await.expect("fake server should finish");
}

#[tokio::test]
async fn concurrent_requests_should_match_out_of_order_responses() {
    let (client, server) = duplex(4096);
    let (client_reader, client_writer) = split(client);
    let (server_reader, mut server_writer) = split(server);
    let connection = AppServerConnection::new(client_reader, client_writer);

    let server_task = tokio::spawn(async move {
        let mut lines = BufReader::new(server_reader).lines();
        let first: Value =
            serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
        let second: Value =
            serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();

        let responses = format!(
            "{{\"id\":{},\"result\":{{\"value\":\"second\"}}}}\n{{\"id\":{},\"result\":{{\"value\":\"first\"}}}}\n",
            second["id"], first["id"]
        );
        server_writer.write_all(responses.as_bytes()).await.unwrap();
    });

    let first_params = json!({});
    let second_params = json!({});
    let first = connection.request::<_, Value>("test/first", &first_params, Duration::from_secs(1));
    let second =
        connection.request::<_, Value>("test/second", &second_params, Duration::from_secs(1));
    let (first, second) = tokio::join!(first, second);

    assert_eq!(first.unwrap()["value"], "first");
    assert_eq!(second.unwrap()["value"], "second");
    server_task.await.unwrap();
}

#[tokio::test]
async fn notifications_should_be_available_without_blocking_responses() {
    let (client, server) = duplex(4096);
    let (client_reader, client_writer) = split(client);
    let (server_reader, mut server_writer) = split(server);
    let connection = AppServerConnection::new(client_reader, client_writer);
    let mut messages = connection
        .take_server_messages()
        .await
        .expect("message receiver should be available once");

    let server_task = tokio::spawn(async move {
        let mut lines = BufReader::new(server_reader).lines();
        let request: Value =
            serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
        server_writer
            .write_all(
                format!(
                    "{{\"method\":\"item/agentMessage/delta\",\"params\":{{\"threadId\":\"thread-a\",\"turnId\":\"turn-a\",\"itemId\":\"item-a\",\"delta\":\"ok\"}}}}\n{{\"id\":{},\"result\":{{\"done\":true}}}}\n",
                    request["id"]
                )
                .as_bytes(),
            )
            .await
            .unwrap();
    });

    let response: Value = connection
        .request("test/request", &json!({}), Duration::from_secs(1))
        .await
        .expect("response should not wait for notification consumption");
    assert_eq!(response["done"], true);
    let message = messages
        .recv()
        .await
        .expect("notification should be routed");
    assert_eq!(message.method, "item/agentMessage/delta");
    assert_eq!(
        serde_json::from_str::<Value>(message.params.get()).unwrap()["delta"],
        "ok"
    );
    server_task.await.unwrap();
}

#[tokio::test]
async fn server_request_id_should_not_consume_client_response() {
    let (client, server) = duplex(4096);
    let (client_reader, client_writer) = split(client);
    let (server_reader, mut server_writer) = split(server);
    let connection = AppServerConnection::new(client_reader, client_writer);

    let server_task = tokio::spawn(async move {
        let mut lines = BufReader::new(server_reader).lines();
        let request: Value = serde_json::from_str(
            &lines
                .next_line()
                .await
                .expect("server should read request")
                .expect("client request should exist"),
        )
        .expect("client request should be JSON");
        let id = &request["id"];
        let messages = format!(
            "{{\"id\":{id},\"method\":\"item/tool/requestUserInput\",\"params\":{{}}}}\n{{\"id\":{id},\"result\":{{\"value\":\"client-response\"}}}}\n"
        );
        server_writer
            .write_all(messages.as_bytes())
            .await
            .expect("server should write messages");
    });

    let result: Value = connection
        .request("test/collision", &json!({}), Duration::from_secs(1))
        .await
        .expect("server request must not consume the client response");

    assert_eq!(result["value"], "client-response");
    server_task.await.expect("fake server should finish");
}

#[tokio::test]
async fn response_should_bypass_notification_queue_backpressure() {
    let (client, server) = duplex(64 * 1024);
    let (client_reader, client_writer) = split(client);
    let (server_reader, mut server_writer) = split(server);
    let connection = AppServerConnection::new(client_reader, client_writer);
    let mut messages = connection
        .take_server_messages()
        .await
        .expect("message receiver should remain connected without consuming");

    let server_task = tokio::spawn(async move {
        let mut lines = BufReader::new(server_reader).lines();
        let request: Value = serde_json::from_str(
            &lines
                .next_line()
                .await
                .expect("server should read request")
                .expect("client request should exist"),
        )
        .expect("client request should be JSON");
        let mut messages = String::new();
        for sequence in 0..257 {
            messages.push_str(&format!(
                "{{\"method\":\"test/event\",\"params\":{{\"sequence\":{sequence}}}}}\n"
            ));
        }
        messages.push_str(&format!(
            "{{\"id\":{},\"result\":{{\"done\":true}}}}\n",
            request["id"]
        ));
        server_writer
            .write_all(messages.as_bytes())
            .await
            .expect("server should write notifications and response");
    });

    let response: Value = connection
        .request("test/backpressure", &json!({}), Duration::from_millis(200))
        .await
        .expect("response should bypass notification queue backpressure");

    assert_eq!(response["done"], true);
    for expected_sequence in 0..257 {
        let message = messages
            .recv()
            .await
            .expect("buffered notification should be delivered");
        let params: Value = serde_json::from_str(message.params.get()).unwrap();
        assert_eq!(params["sequence"], expected_sequence);
    }
    server_task.await.expect("fake server should finish");
}

#[tokio::test]
async fn overflow_should_preserve_lifecycle_events_and_report_dropped_deltas() {
    const MESSAGE_COUNT: usize = 600;
    const CONTROL_INTERVAL: usize = 3;

    let (client, server) = duplex(256 * 1024);
    let (client_reader, client_writer) = split(client);
    let (server_reader, mut server_writer) = split(server);
    let connection = AppServerConnection::new(client_reader, client_writer);
    let mut received = connection
        .take_server_messages()
        .await
        .expect("message receiver should remain connected without consuming");

    let server_task = tokio::spawn(async move {
        let mut lines = BufReader::new(server_reader).lines();
        let request: Value = serde_json::from_str(
            &lines
                .next_line()
                .await
                .expect("server should read request")
                .expect("client request should exist"),
        )
        .expect("client request should be JSON");
        let mut payload = String::new();
        for index in 0..MESSAGE_COUNT {
            if index % CONTROL_INTERVAL == 0 {
                let control_index = index / CONTROL_INTERVAL;
                let (id, method) = match control_index % 3 {
                    0 => ("null".to_owned(), "turn/completed"),
                    1 => ("null".to_owned(), "item/completed"),
                    _ => (
                        (10_000 + control_index).to_string(),
                        "item/tool/requestUserInput",
                    ),
                };
                payload.push_str(&format!(
                    "{{\"id\":{id},\"method\":\"{method}\",\"params\":{{\"threadId\":\"thread-a\",\"index\":{control_index}}}}}\n"
                ));
            } else {
                payload.push_str(&format!(
                    "{{\"method\":\"item/agentMessage/delta\",\"params\":{{\"threadId\":\"thread-a\",\"turnId\":\"turn-a\",\"itemId\":\"item-a\",\"delta\":\"{index}\"}}}}\n"
                ));
            }
        }
        payload.push_str(&format!(
            "{{\"id\":{},\"result\":{{\"done\":true}}}}\n",
            request["id"]
        ));
        server_writer
            .write_all(payload.as_bytes())
            .await
            .expect("server should write mixed messages and response");
    });

    let response: Value = connection
        .request(
            "test/mixed-backpressure",
            &json!({}),
            Duration::from_millis(500),
        )
        .await
        .expect("response should bypass mixed notification backpressure");
    assert_eq!(response["done"], true);

    let mut control_indexes = Vec::new();
    let mut saw_resync = false;
    while let Some(message) = received.recv().await {
        if message.method == "codeagent/eventRetentionExceeded" {
            saw_resync = true;
            continue;
        }
        if message.method != "item/agentMessage/delta" {
            let params: Value = serde_json::from_str(message.params.get()).unwrap();
            control_indexes.push(params["index"].as_u64().unwrap() as usize);
        }
    }

    assert_eq!(
        control_indexes,
        (0..MESSAGE_COUNT / CONTROL_INTERVAL).collect::<Vec<_>>()
    );
    assert!(
        saw_resync,
        "discarded deltas must trigger an explicit resync signal"
    );
    server_task.await.expect("fake server should finish");
}
