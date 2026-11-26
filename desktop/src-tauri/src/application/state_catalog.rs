use super::AppState;
use crate::infrastructure::acp_runtime::valid_agent_engine;
use serde_json::json;
use tauri::AppHandle;

impl AppState {
    /// 断连清理可省略原生窗口后处理；确认回调必须在实际发布后立即执行。
    pub(crate) async fn publish_acp_event(
        &self,
        app: Option<&AppHandle>,
        mut event: serde_json::Value,
        published: impl FnOnce(),
    ) {
        crate::application::acp_host::normalize_event(&mut event);
        // 实时事件沿用任务创建的引擎校验，保留第三方身份。缺省或无效标识沿用旧宿主的回退值。
        if !event["provider"].as_str().is_some_and(valid_agent_engine) {
            event["provider"] = json!("claude");
        }
        event["version"] = json!(2);
        event["sequence"] = json!(0);
        event["sessionId"] = json!(crate::application::state::runtime_session_id());
        event["timestamp"] = json!(chrono::Utc::now().to_rfc3339());
        event["receivedAtUnixMs"] = json!(chrono::Utc::now().timestamp_millis());
        super::event_publisher::publish_mapped_event_at_boundary(
            &self.runtime,
            event.into(),
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
            "sessionId":crate::application::state::runtime_session_id()});
        super::event_publisher::publish_mapped_event(&self.runtime, event.into(), Some(app)).await;
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
        for (index, (engine, expected)) in [
            (Some("codex"), "codex"),
            (Some("claude"), "claude"),
            (Some("acp-custom-2"), "acp-custom-2"),
            (None, "claude"),
            (Some("acp-"), "claude"),
            (Some("acp-invalid/path"), "claude"),
        ]
        .into_iter()
        .enumerate()
        {
            let mut event = json!({"type":"acp.session.updated","taskId":"t","payload":{"state":{"configOptions":[],"availableCommands":[]}}});
            if let Some(engine) = engine {
                event["provider"] = json!(engine);
            }
            state.publish_acp_event(None, event, || {}).await;
            let messages = received.lock().unwrap();
            assert_eq!(messages.len(), index + 1);
            let event = &messages[index]["data"]["event"];
            assert_eq!(event["provider"], expected, "provider 输入为 {engine:?}");
            assert_eq!(event["type"], "acp.session.updated");
        }
    }
}
