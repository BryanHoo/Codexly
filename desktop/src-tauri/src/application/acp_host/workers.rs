use super::{
    snapshot_response,
    transport::{Routed, Transport},
};
use crate::{application::state::AppState, infrastructure::local_catalog::LocalCatalog};
use serde_json::json;
use std::{
    collections::VecDeque,
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{AppHandle, Manager};
use tokio::{
    io::{AsyncRead, AsyncReadExt},
    sync::mpsc,
    time::Instant,
};

pub(super) async fn catalog_loop(
    mut receiver: mpsc::Receiver<Routed>,
    catalog: LocalCatalog,
    transport: Arc<Transport>,
) {
    while let Some(frame) = receiver.recv().await {
        let message = frame.message;
        let result = match message["operation"].as_str() {
            Some(
                // 普通聊天首发会保存预览，辅助生成发送提示词前会登记独立的后台会话。
                operation @ ("task.read"
                | "task.put"
                | "task.patch"
                | "task.preview"
                | "task.list"
                | "task.remove"
                | "app.preferences.read"
                | "app.preferences.patch"
                | "acp.title.claim"
                | "acp.title.finish"
                | "acp.session.background"
                // 默认配置读取可能触发历史目录发现，需要项目、已有绑定和后台会话索引。
                | "project.list"
                | "task.bindings"
                | "acp.session.background.list"
                | "acp.session.rebind"
                | "acp.storage.read"
                | "acp.storage.claim"
                | "acp.storage.release"),
            ) => catalog
                .call(operation, message["payload"].clone())
                .await
                .map_err(|error| error.to_string()),
            _ => Err("Unsupported ACP catalog operation".to_owned()),
        };
        let response = match result {
            Ok(result) => json!({"catalogId":message["catalogId"],"result":result}),
            Err(error) => json!({"catalogId":message["catalogId"],"error":error}),
        };
        if transport
            .write(&response, Instant::now() + Duration::from_secs(30))
            .await
            .is_err()
        {
            transport.fail("ACP catalog reply delivery failed");
            return;
        }
    }
}

pub(super) async fn event_loop(
    mut receiver: mpsc::Receiver<Routed>,
    app: AppHandle,
    transport: Arc<Transport>,
) {
    while let Some(mut frame) = receiver.recv().await {
        let message = &mut frame.message;
        if let Some(project) = message["snapshotProjectId"].as_str().map(str::to_owned) {
            let result = message["result"].take();
            message["result"] = snapshot_response(&app.state::<AppState>(), &project, result).await;
            transport.respond(message.take());
        } else {
            let event = message["event"].take();
            // 本地存储终止也结束前端运行态，但不伪造已入历史的完成事件。
            let completed = if event["type"] == "turn.completed"
                || (event["type"] == "provider.error"
                    && event["payload"]["willRetry"].as_bool() == Some(false))
            {
                event["taskId"]
                    .as_str()
                    .zip(event["turnId"].as_str())
                    .map(|(task, turn)| (task.to_owned(), turn.to_owned()))
            } else {
                None
            };
            app.state::<AppState>()
                .publish_acp_event(Some(&app), event, || {
                    if let Some((task, turn)) = completed {
                        let mut active = transport
                            .active_turns
                            .lock()
                            .unwrap_or_else(|e| e.into_inner());
                        if active
                            .get(&task)
                            .is_some_and(|(_, active_turn, _)| *active_turn == turn)
                        {
                            active.remove(&task);
                        }
                    }
                })
                .await;
        }
        // permit 随整帧处理结束才释放，因此正在处理的慢事件也计入总字节预算。
    }
}

pub(super) async fn fail_active_turns(
    app: &AppHandle,
    catalog: &LocalCatalog,
    transport: &Transport,
) {
    let active = std::mem::take(
        &mut *transport
            .active_turns
            .lock()
            .unwrap_or_else(|e| e.into_inner()),
    );
    // 先发布所有失败事实，再尝试持久化；一个慢数据库不能阻止其余会话离开运行态。
    for (task, (_, turn, engine)) in &active {
        app.state::<AppState>().publish_acp_event(None,
            json!({"type":"provider.error","provider":engine,"taskId":task,"turnId":turn,"payload":{"message":"Agent host connection closed","willRetry":false}}), || {}).await;
    }
    for task in active.keys() {
        let _ = catalog
            .call("task.patch", json!({"id":task,"status":"failed"}))
            .await;
    }
}

pub(super) type StderrTail = Arc<Mutex<VecDeque<String>>>;

// stderr 可能包含任意模型正文或认证数据。只保留固定错误分类和字节数，绝不留存原文。
fn diagnostic_code(bytes: &[u8]) -> &'static str {
    for (pattern, code) in [
        (b"EPIPE".as_slice(), "EPIPE"),
        (b"ENOENT", "ENOENT"),
        (b"EACCES", "EACCES"),
        (b"ETIMEDOUT", "ETIMEDOUT"),
        (b"SyntaxError", "SyntaxError"),
        (b"TypeError", "TypeError"),
        (b"ReferenceError", "ReferenceError"),
        (b"Claude host transport:", "transport_failure"),
    ] {
        if bytes.windows(pattern.len()).any(|part| part == pattern) {
            return code;
        }
    }
    "redacted_stderr"
}

pub(super) async fn stderr_loop<R: AsyncRead + Unpin>(mut reader: R, tail: StderrTail) {
    let mut buffer = [0u8; 2048];
    loop {
        let Ok(count) = reader.read(&mut buffer).await else {
            return;
        };
        if count == 0 {
            return;
        }
        let code = diagnostic_code(&buffer[..count]);
        let mut tail = tail.lock().unwrap_or_else(|e| e.into_inner());
        if tail.len() == 16 {
            tail.pop_front();
        }
        tail.push_back(format!("{code} ({count} bytes)"));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn acp_application_catalog_should_support_discovery_generation_and_titles() {
        use super::super::transport::writer_loop;
        use tokio::io::{AsyncBufReadExt, BufReader};
        let root = tempfile::tempdir().unwrap();
        let catalog = LocalCatalog::at(root.path()).unwrap();
        catalog.call("task.put", json!({"id":"new","provider":"codex","projectId":null,"title":"","cwd":"/workspace","sessionId":null,"updatedAt":1,"pinned":false,"archived":false,"status":"idle"})).await.unwrap();
        catalog
            .call("task.patch", json!({"id":"new","sessionId":"native"}))
            .await
            .unwrap();
        let task = catalog
            .call("task.read", json!({"id":"new"}))
            .await
            .unwrap();
        let (transport, outbound) = Transport::new();
        let (writer, reader) = tokio::io::duplex(8192);
        let writing = tokio::spawn(writer_loop(writer, outbound, Arc::clone(&transport)));
        let (sender, receiver) = mpsc::channel(1);
        let serving = tokio::spawn(catalog_loop(receiver, catalog, Arc::clone(&transport)));
        let mut lines = BufReader::new(reader).lines();
        for (operation, payload, expected) in [
            (
                "acp.storage.claim",
                json!({"key":"history/t","owner":"one","pid":123,"expectedOwner":null}),
                json!(true),
            ),
            (
                "acp.storage.read",
                json!({"key":"history/t"}),
                json!({"owner":"one","pid":123}),
            ),
            (
                "acp.storage.release",
                json!({"key":"history/t","owner":"one"}),
                json!(true),
            ),
            ("app.preferences.read", json!({}), serde_json::Value::Null),
            // 使用测试 Agent 隔离目录启动时从本机 Codex 索引恢复的后台会话。
            (
                "acp.session.background",
                json!({"engine":"acp-test","sessionId":"helper"}),
                serde_json::Value::Null,
            ),
            // 常规 Rust 测试也经宿主桥接验证历史发现的三项查询，无需预先编译 sidecar。
            ("project.list", serde_json::Value::Null, json!([])),
            ("task.bindings", serde_json::Value::Null, json!([task])),
            (
                "acp.session.background.list",
                json!({"engine":"acp-test"}),
                json!(["helper"]),
            ),
            (
                "acp.title.claim",
                json!({"id":"new","token":"one","engine":"codex","projectId":null}),
                json!(true),
            ),
            (
                "acp.title.finish",
                json!({"id":"new","token":"one","title":"自动标题"}),
                json!("自动标题"),
            ),
        ] {
            sender
                .send(Routed {
                    message: json!({"catalogId":1,"operation":operation,"payload":payload}),
                    _budget: Arc::clone(&transport.inbound_budget)
                        .acquire_owned()
                        .await
                        .unwrap(),
                })
                .await
                .unwrap();
            let line = tokio::time::timeout(Duration::from_secs(3), lines.next_line())
                .await
                .unwrap()
                .unwrap()
                .unwrap();
            let response: serde_json::Value = serde_json::from_str(&line).unwrap();
            assert!(response["error"].is_null(), "{response}");
            assert_eq!(response["result"], expected);
        }
        drop(sender);
        serving.await.unwrap();
        writing.abort();
    }
    #[tokio::test]
    async fn stderr_should_keep_only_bounded_redacted_error_codes() {
        let tail: StderrTail = Arc::default();
        let bytes = format!(
            "TypeError Bearer secret-value /Users/private/path {}",
            "secret".repeat(20000)
        );
        stderr_loop(bytes.as_bytes(), Arc::clone(&tail)).await;
        let tail = tail.lock().unwrap();
        assert_eq!(tail.len(), 16);
        assert!(
            tail.iter()
                .all(|line| !line.contains("secret") && !line.contains("private"))
        );
        assert_eq!(diagnostic_code(b"EPIPE api_key=secret"), "EPIPE");
    }
}
