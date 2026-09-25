use super::*;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, duplex, split};

#[tokio::test]
async fn task_title_should_collect_early_output_and_release_hidden_thread_on_success_or_failure() {
    for (output, expected) in [
        (r#"{"title":"修复任务标题生成"}"#, Some("修复任务标题生成")),
        ("invalid model output", None),
    ] {
        let state = AppState::default();
        let app_data = std::env::temp_dir().join(format!(
            "codeagent-title-model-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
        ));
        let mut settings = crate::infrastructure::local_settings::read_global_settings(&app_data)
            .await
            .unwrap();
        settings["commitMessageModel"] = json!("git-message-model");
        crate::infrastructure::local_settings::update_global_settings(&app_data, settings)
            .await
            .unwrap();
        let (client, server) = duplex(32 * 1024);
        let (reader, writer) = split(client);
        let connection = AppServerConnection::new(reader, writer);
        let forwarder = spawn_event_forwarder(
            Arc::clone(&state.runtime),
            connection.take_server_messages().await.unwrap(),
            None,
        );
        let (reader, mut writer) = split(server);
        let peer = tokio::spawn(async move {
            let mut lines = BufReader::new(reader).lines();
            let mut requests = vec![
                ("config/read", json!({"config": {}})),
                ("thread/start", json!({"thread": {"id": "hidden"}})),
                ("turn/start", json!({"turn": {"id": "turn"}})),
            ];
            if expected.is_none() {
                requests.push(("turn/interrupt", json!({})));
            }
            requests.push(("thread/unsubscribe", json!({"status": "unsubscribed"})));
            for (method, result) in requests {
                let request: Value =
                    serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
                assert_eq!(request["method"], method);
                if method == "thread/start" {
                    assert_eq!(request["params"]["model"], "git-message-model");
                }
                if method == "turn/start" {
                    // 模拟 Codex 在 RPC 响应前就完成辅助 Turn，验证通知不会丢失。
                    for notification in [
                        json!({"method": "item/completed", "params": {
                            "threadId": "hidden", "turnId": "turn",
                            "item": {"id": "message", "type": "agentMessage", "text": output, "phase": "final_answer"},
                        }}),
                        json!({"method": "turn/completed", "params": {
                            "threadId": "hidden", "turn": {"id": "turn", "status": "completed", "items": [], "error": null},
                        }}),
                    ] {
                        writer
                            .write_all(format!("{notification}\n").as_bytes())
                            .await
                            .unwrap();
                    }
                }
                if method == "turn/interrupt" {
                    assert_eq!(
                        request["params"],
                        json!({"threadId": "hidden", "turnId": "turn"})
                    );
                }
                writer
                    .write_all(
                        format!("{}\n", json!({"id": request["id"], "result": result})).as_bytes(),
                    )
                    .await
                    .unwrap();
            }
        });
        let result = super::super::task_title_generation::generate_title(
            &state,
            &connection,
            "/work",
            &app_data,
            "生成标题",
        )
        .await;
        assert_eq!(result.ok().as_deref(), expected);
        // 辅助线程未登记项目归属，因此输出不会污染可见任务和侧栏。
        assert!(state.runtime.lock().await.task_projects.is_empty());
        peer.await.unwrap();
        forwarder.abort();
        tokio::fs::remove_dir_all(app_data).await.unwrap();
    }
}
