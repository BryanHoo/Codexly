use super::{AppServerConnection, start_turn, unsubscribe_task};
use crate::domain::conversation::{AgentPromptInput, AgentTurnOptions};
use serde_json::{Value, json};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, duplex, split};

#[tokio::test]
async fn continuing_a_task_should_not_lose_subscription_to_an_inflight_release() {
    let (client, server) = duplex(16 * 1024);
    let (reader, writer) = split(client);
    let connection = AppServerConnection::new(reader, writer);
    let (reader, mut writer) = split(server);
    let (read_started, ready) = tokio::sync::oneshot::channel();
    let peer = tokio::spawn(async move {
        let mut lines = BufReader::new(reader).lines();
        let read: Value = serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
        assert_eq!(read["method"], "thread/read");
        read_started.send(()).unwrap();
        let mut subscribed = true;
        let mut processed = 0;
        // 退订已读取 idle，但结果尚未返回时，用户恢复并启动新回合。
        // 修复后启动应等待退订完成；旧实现会先 resume/start，再被迟到退订切断输出。
        if let Ok(Some(line)) = tokio::time::timeout(Duration::from_millis(100), lines.next_line())
            .await
            .unwrap_or(Ok(None))
        {
            let request: Value = serde_json::from_str(&line).unwrap();
            assert_eq!(request["method"], "thread/resume");
            writer
                .write_all(
                    format!("{}\n", json!({"id":request["id"],"result":reply(&request)}))
                        .as_bytes(),
                )
                .await
                .unwrap();
            let request: Value =
                serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
            assert_eq!(request["method"], "turn/start");
            writer
                .write_all(
                    format!("{}\n", json!({"id":request["id"],"result":reply(&request)}))
                        .as_bytes(),
                )
                .await
                .unwrap();
            processed = 2;
        }
        writer
            .write_all(format!("{}\n", json!({"id":read["id"],"result":reply(&read)})).as_bytes())
            .await
            .unwrap();
        for _ in processed..5 {
            let request: Value =
                serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
            match request["method"].as_str().unwrap() {
                "thread/resume" => subscribed = true,
                "thread/unsubscribe" => subscribed = false,
                _ => {}
            }
            writer
                .write_all(
                    format!("{}\n", json!({"id":request["id"],"result":reply(&request)}))
                        .as_bytes(),
                )
                .await
                .unwrap();
        }
        subscribed
    });
    let (released, started) = tokio::join!(
        unsubscribe_task(&connection, "project-a", "thread-a"),
        async {
            ready.await.unwrap();
            start_turn(
                &connection,
                "project-a".into(),
                "thread-a".into(),
                AgentPromptInput::text("继续"),
                AgentTurnOptions::default(),
                &Default::default(),
            )
            .await
        },
    );
    released.unwrap();
    assert_eq!(started.unwrap().turn.status, "running");
    assert!(peer.await.unwrap(), "新回合运行中时输出订阅必须仍然存在");
}

fn reply(request: &Value) -> Value {
    match request["method"].as_str().unwrap() {
        "thread/read" => {
            json!({"thread":{"id":"thread-a","projectId":"project-a","status":{"type":"idle"},"preview":"","updatedAt":0}})
        }
        "thread/resume" => json!({"thread":{"id":"thread-a","projectId":"project-a"}}),
        "thread/backgroundTerminals/list" | "thread/queue/list" => {
            json!({"data":[],"nextCursor":null})
        }
        "thread/unsubscribe" => json!({"status":"unsubscribed"}),
        "turn/start" => {
            json!({"turn":{"id":"turn-next","status":"inProgress","items":[],"error":null}})
        }
        method => panic!("unexpected RPC: {method}"),
    }
}

#[tokio::test]
async fn subscription_operations_should_only_block_the_same_task_and_release_on_cancellation() {
    let (client, _server) = duplex(1024);
    let (reader, writer) = split(client);
    let connection = AppServerConnection::new(reader, writer);
    let first = connection.lock_task_subscription("task-a").await.unwrap();
    let independent = tokio::time::timeout(
        Duration::from_millis(100),
        connection.lock_task_subscription("task-b"),
    )
    .await;
    assert!(independent.is_ok(), "不同任务不能因订阅锁相互等待");
    assert!(
        tokio::time::timeout(
            Duration::from_millis(10),
            connection.lock_task_subscription("task-a")
        )
        .await
        .is_err()
    );
    drop(first);
    assert!(
        tokio::time::timeout(
            Duration::from_millis(100),
            connection.lock_task_subscription("task-a")
        )
        .await
        .is_ok(),
        "取消等待不能遗留订阅锁"
    );
}
