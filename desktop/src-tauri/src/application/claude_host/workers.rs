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
    app: Option<AppHandle>,
) {
    let mut generation = tokio::task::JoinSet::new();
    while let Some(frame) = receiver.recv().await {
        let message = frame.message;
        if message["operation"] == "generation.title" {
            // 辅助推理单独限流，不能阻塞目录读写或主回合事件处理。
            while generation.try_join_next().is_some() {}
            if let Some(app) = app.clone().filter(|_| generation.len() < 2) {
                let transport = Arc::clone(&transport);
                generation.spawn(async move {
                    let result = if let (Some(cwd), Some(text)) = (
                        message["payload"]["cwd"].as_str(),
                        message["payload"]["text"].as_str(),
                    ) {
                        crate::application::task_title_generation::generate_application_title(
                            &app, cwd, text,
                        )
                        .await
                        .map(serde_json::Value::String)
                        .map_err(|error| error.to_string())
                    } else {
                        Err("Invalid title request".to_owned())
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
                        transport.fail("Claude title reply delivery failed");
                    }
                });
                continue;
            }
        }
        let result = match message["operation"].as_str() {
            Some("task.settings") => {
                // 自动续发只读取应用偏好，不连接 Codex；归属必须先经过本地目录校验。
                if let (Some(app), Some(project), Some(task)) = (
                    app.as_ref(),
                    message["payload"]["projectId"].as_str(),
                    message["payload"]["taskId"].as_str(),
                ) {
                    async {
                        catalog
                            .owned_task(project, task)
                            .await
                            .map_err(|error| error.to_string())?;
                        let app_data = crate::infrastructure::app_data::directory(app)
                            .map_err(|error| error.to_string())?;
                        let settings = crate::infrastructure::task_settings::read_task_settings(
                            &app_data, project, task,
                        )
                        .await
                        .map_err(|error| error.to_string())?;
                        serde_json::to_value(settings).map_err(|error| error.to_string())
                    }
                    .await
                } else {
                    Err("Invalid Claude task settings request".to_owned())
                }
            }
            Some(
                operation @ ("task.read" | "task.put" | "task.patch" | "task.list" | "task.remove"
                | "usage.record"),
            ) if operation != "usage.record" || message["payload"]["engine"] == "claude" => catalog
                .call(operation, message["payload"].clone())
                .await
                .map_err(|error| error.to_string()),
            _ => Err("Unsupported Claude catalog operation".to_owned()),
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
            transport.fail("Claude catalog reply delivery failed");
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
            let completed = if event["type"] == "turn.completed" {
                event["taskId"]
                    .as_str()
                    .zip(event["turnId"].as_str())
                    .map(|(task, turn)| (task.to_owned(), turn.to_owned()))
            } else {
                None
            };
            app.state::<AppState>()
                .publish_claude_event(Some(&app), event, || {
                    if let Some((task, turn)) = completed {
                        let mut active = transport
                            .active_turns
                            .lock()
                            .unwrap_or_else(|e| e.into_inner());
                        if active
                            .get(&task)
                            .is_some_and(|(_, active_turn)| *active_turn == turn)
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
    for (task, (_, turn)) in &active {
        app.state::<AppState>().publish_claude_event(None,
            json!({"type":"provider.error","taskId":task,"turnId":turn,"payload":{"message":"Claude host connection closed","willRetry":false}}), || {}).await;
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
