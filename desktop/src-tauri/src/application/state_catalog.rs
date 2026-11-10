use super::AppState;
use serde_json::json;
use tauri::AppHandle;

impl AppState {
    /// 断连清理可省略原生窗口后处理；确认回调必须在实际发布后立即执行。
    pub(crate) async fn publish_claude_event(
        &self,
        app: Option<&AppHandle>,
        mut event: serde_json::Value,
        published: impl FnOnce(),
    ) {
        crate::application::claude_host::normalize_event(&mut event);
        // 共享 ACP 宿主已提供任务引擎；仅旧 Claude 宿主缺省帧沿用原来的 Claude 标识。
        if !matches!(event["provider"].as_str(), Some("codex" | "claude")) {
            event["provider"] = json!("claude");
        }
        event["version"] = json!(2);
        event["sequence"] = json!(0);
        event["sessionId"] = json!(crate::infrastructure::codex::runtime_session_id());
        event["timestamp"] = json!(chrono::Utc::now().to_rfc3339());
        event["receivedAtUnixMs"] = json!(chrono::Utc::now().timestamp_millis());
        super::event_publisher::publish_mapped_event_at_boundary(
            &self.runtime,
            event.into(),
            None,
            app,
            published,
        )
        .await;
    }
    /// 本地管理操作复用应用事件流，使其他窗口按同一 checkpoint 刷新侧栏。
    pub async fn publish_catalog_task_change(
        &self,
        app: &AppHandle,
        project: &str,
        task: &str,
        reason: Option<&str>,
    ) {
        self.remember_tasks(project, [task]).await;
        let event = json!({"type":if reason.is_some(){"task.removed"}else{"task.metadata_changed"},
            "taskId":task,"payload":reason.map_or_else(||json!({}),|reason|json!({"reason":reason})),
            "timestamp":chrono::Utc::now().to_rfc3339(),"sequence":0,"version":2,"provider":"codex",
            "sessionId":crate::infrastructure::codex::runtime_session_id()});
        super::event_publisher::publish_mapped_event(&self.runtime, event.into(), None, Some(app))
            .await;
        if reason.is_some()
            && let Ok(connection) = self.codex_connection().await
        {
            let task = task.to_owned();
            // 解除执行订阅只是资源回收，失败不能回滚已经持久化的管理操作。
            tauri::async_runtime::spawn(async move {
                let result: Result<serde_json::Value, _> = connection
                    .request(
                        "thread/unsubscribe",
                        &json!({"threadId":task}),
                        std::time::Duration::from_secs(3),
                    )
                    .await;
                if let Err(error) = result {
                    log::debug!("已移除任务的执行订阅未释放: {error}");
                }
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::AppState;
    use serde_json::{Value, json};
    use std::sync::{Arc, Mutex};
    use tauri::ipc::{Channel, InvokeResponseBody};

    #[tokio::test]
    async fn shared_host_events_should_preserve_engine_identity_at_native_delivery() {
        let state = AppState::default();
        state.remember_tasks("p", ["t"]).await;
        let received = Arc::new(Mutex::new(Vec::<Value>::new()));
        let output = Arc::clone(&received);
        state
            .runtime
            .lock()
            .await
            .set_event_channel(Channel::new(move |body| {
                if let InvokeResponseBody::Json(body) = body {
                    output
                        .lock()
                        .unwrap()
                        .push(serde_json::from_str(&body).unwrap());
                }
                Ok(())
            }));
        for engine in [Some("codex"), Some("claude"), None] {
            let mut event = json!({"type":"acp.session.updated","taskId":"t","payload":{"state":{"configOptions":[],"availableCommands":[]}}});
            if let Some(engine) = engine {
                event["provider"] = json!(engine);
            }
            state.publish_claude_event(None, event, || {}).await;
            let messages = received.lock().unwrap();
            let event = &messages.last().unwrap()["data"]["event"];
            assert_eq!(event["provider"], engine.unwrap_or("claude"));
            assert_eq!(event["type"], "acp.session.updated");
        }
    }
}
