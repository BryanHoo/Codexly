use std::sync::{Arc, Mutex};

use serde_json::{Value, json};
use tauri::ipc::{Channel, InvokeResponseBody};

use super::RuntimeSession;
use crate::domain::runtime::AppEvent;

#[tokio::test]
async fn slow_webview_should_bound_unacknowledged_bytes() {
    let received = Arc::new(Mutex::new(Vec::new()));
    let output = Arc::clone(&received);
    let mut session = RuntimeSession::default();
    session.set_event_channel(Channel::new(move |body| {
        if let InvokeResponseBody::Json(body) = body {
            output.lock().unwrap().push(body);
        }
        Ok(())
    }));
    let sender = session.event_sender.as_ref().unwrap();
    for sequence in 1..=2_000 {
        sender.publish(AppEvent::AgentEvent {
            event: json!({"type":"command.output_delta", "sequence":sequence,
                "taskId":"task-a", "payload":{"delta":"x".repeat(16_384)}})
            .into(),
        });
    }
    let stats = sender.snapshot();
    assert!(stats.in_flight_bytes <= 1_048_576);
    assert!(stats.queued_bytes <= 4 * 1_048_576);
    let messages = received.lock().unwrap();
    assert!(messages.iter().map(String::len).sum::<usize>() <= 1_048_576);
    assert!(
        messages.iter().any(|body| {
            serde_json::from_str::<Value>(body).unwrap()["type"] == "resyncRequired"
        })
    );
}

#[test]
fn acknowledgements_should_release_only_real_packets_and_reject_stale_generations() {
    let received = Arc::new(Mutex::new(Vec::new()));
    let output = Arc::clone(&received);
    let mut session = RuntimeSession::default();
    session.set_event_channel(Channel::new(move |body| {
        if let InvokeResponseBody::Json(body) = body {
            output.lock().unwrap().push(body);
        }
        Ok(())
    }));
    let stream = session.event_sender.as_ref().unwrap();
    for sequence in 0..100 {
        stream.publish(AppEvent::AgentEvent {
            event: json!({"sequence":sequence,"type":"message.delta"}).into(),
        });
    }
    assert_eq!(received.lock().unwrap().len(), 56);
    let before = stream.snapshot().in_flight_bytes;
    stream.acknowledge(0, &[1]);
    stream.acknowledge(1, &[1_000]);
    assert_eq!(stream.snapshot().in_flight_bytes, before);
    stream.acknowledge(1, &[1, 1]);
    assert_eq!(received.lock().unwrap().len(), 57);
    for id in 2..=100 {
        stream.acknowledge(1, &[id]);
    }
    assert_eq!(stream.snapshot().in_flight_bytes, 0);
    assert_eq!(stream.snapshot().queued_bytes, 0);
    let old = Arc::clone(stream);
    session.set_event_channel(Channel::new(|_| Ok(())));
    old.publish(AppEvent::AgentEvent {
        event: json!({"type":"message.delta"}).into(),
    });
    assert_eq!(received.lock().unwrap().len(), 100);
}

#[tokio::test]
async fn rpc_and_approval_should_progress_through_the_full_pipeline_without_webview_ack() {
    use crate::infrastructure::codex::AppServerConnection;
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, duplex, split};
    use tokio::time::{Duration, timeout};

    let runtime = Arc::new(tokio::sync::Mutex::new(RuntimeSession::default()));
    let received = Arc::new(Mutex::new(Vec::new()));
    let output = Arc::clone(&received);
    {
        let mut state = runtime.lock().await;
        state
            .task_projects
            .insert("thread-a".to_owned(), "project-a".to_owned());
        state.set_event_channel(Channel::new(move |body| {
            if let InvokeResponseBody::Json(body) = body {
                output.lock().unwrap().push(body);
            }
            Ok(())
        }));
    }
    let (client, server) = duplex(64 * 1024);
    let (reader, writer) = split(client);
    let connection = AppServerConnection::new(reader, writer);
    let forwarder = super::spawn_event_forwarder(
        Arc::clone(&runtime),
        connection.take_server_messages().await.unwrap(),
        None,
    );
    let (server_reader, mut server_writer) = split(server);
    let server = tokio::spawn(async move {
        let request: Value = serde_json::from_str(
            &BufReader::new(server_reader)
                .lines()
                .next_line()
                .await
                .unwrap()
                .unwrap(),
        )
        .unwrap();
        let output = format!(
            "{}\n",
            json!({"method":"item/commandExecution/outputDelta","params":{
                "threadId":"thread-a","turnId":"turn-a","itemId":"item-a","delta":"x".repeat(16_384)
            }})
        );
        for _ in 0..2_000 {
            server_writer.write_all(output.as_bytes()).await.unwrap();
        }
        let approval = format!(
            "{}\n",
            json!({"id":9,"method":"item/commandExecution/requestApproval","params":{
                "threadId":"thread-a","turnId":"turn-a","itemId":"item-a","kind":"command",
                "command":"pwd","cwd":"/work","startedAtMs":1735689600000_i64,"availableDecisions":["accept","decline"]
            }})
        );
        server_writer.write_all(approval.as_bytes()).await.unwrap();
        server_writer
            .write_all(
                format!("{}\n", json!({"id":request["id"],"result":{"done":true}})).as_bytes(),
            )
            .await
            .unwrap();
        server_writer
    });
    let response: Value = connection
        .request("test/pressure", &json!({}), Duration::from_secs(10))
        .await
        .unwrap();
    assert_eq!(response["done"], true);
    let server_writer = server.await.unwrap();
    timeout(Duration::from_secs(2), async {
        loop {
            if runtime
                .lock()
                .await
                .pending_requests
                .contains_key("number:9")
            {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("approval registration must not wait for WebView");
    let stats = runtime
        .lock()
        .await
        .event_sender
        .as_ref()
        .unwrap()
        .snapshot();
    assert!(stats.in_flight_high_watermark <= 1_048_576);
    assert!(stats.queued_high_watermark <= 4 * 1_048_576);
    assert!(
        received
            .lock()
            .unwrap()
            .iter()
            .any(|body| body.contains("pending_request.created"))
    );
    println!(
        "RUNTIME_BACKPRESSURE {}",
        serde_json::to_string(&stats).unwrap()
    );
    drop(server_writer);
    forwarder.await.unwrap();
}
