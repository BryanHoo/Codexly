use super::*;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, duplex, split};

#[tokio::test]
async fn fork_should_inherit_each_available_source_field_and_preserve_local_fallbacks() {
    for project in ["project-a", "temporary"] {
        for (model, effort) in [
            (Some("live-model"), Some("xhigh")),
            (Some("live-model"), None),
            (None, Some("minimal")),
            (None, None),
        ] {
            let (client, server) = duplex(4096);
            let (reader, writer) = split(client);
            let connection = AppServerConnection::new(reader, writer);
            let expected_model = model.unwrap_or("saved-model");
            let expected_effort = effort.unwrap_or("low");
            let server_task = tokio::spawn(async move {
                let (reader, mut writer) = split(server);
                let mut lines = BufReader::new(reader).lines();
                let mut thread = json!({"id":"source", "name":null, "preview":"任务",
                    "projectId":if project == "temporary" {None} else {Some(project)},
                    "section":null, "status":{"type":"notLoaded"}, "updatedAt":1735689600,
                    "model":model, "reasoningEffort":effort});
                for method in ["thread/read", "thread/fork"] {
                    let request: Value =
                        serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
                    assert_eq!(request["method"], method);
                    assert_eq!(request["params"]["threadId"], "source");
                    if method == "thread/read" {
                        assert_eq!(request["params"]["includeTurns"], false);
                    } else {
                        assert_eq!(request["params"]["model"], expected_model);
                        assert_eq!(
                            request["params"]["config"]["model_reasoning_effort"],
                            expected_effort
                        );
                        assert_eq!(
                            request["params"]["config"]["model_reasoning_summary"],
                            "auto"
                        );
                        assert_eq!(request["params"]["excludeTurns"], true);
                        assert!(request["params"].get("lastTurnId").is_none());
                        thread["id"] = json!("forked");
                    }
                    writer
                        .write_all(
                            format!(
                                "{}\n",
                                json!({"id":request["id"], "result":{"thread":thread}})
                            )
                            .as_bytes(),
                        )
                        .await
                        .unwrap();
                }
            });
            let mut settings = AgentTaskSettings {
                model: "saved-model".into(),
                reasoning_effort: "low".into(),
                approval_policy: json!("never"),
                approvals_reviewer: "auto_review".into(),
                sandbox_mode: "read-only".into(),
            };
            let result = fork_task(&connection, project, "source", None, &mut settings)
                .await
                .unwrap();
            assert_eq!(result.task.id, "forked");
            // 调用方将这份配置持久化到分叉；不能再保存覆盖前的本地默认值。
            assert_eq!(settings.model, expected_model);
            assert_eq!(settings.reasoning_effort, expected_effort);
            assert_eq!(settings.approval_policy, json!("never"));
            assert_eq!(settings.approvals_reviewer, "auto_review");
            assert_eq!(settings.sandbox_mode, "read-only");
            server_task.await.unwrap();
        }
    }
}

#[tokio::test]
async fn fork_should_reject_a_source_with_the_wrong_identity() {
    let (client, server) = duplex(4096);
    let (reader, writer) = split(client);
    let connection = AppServerConnection::new(reader, writer);
    let server_task =
        tokio::spawn(async move {
            let (reader, mut writer) = split(server);
            let mut lines = BufReader::new(reader).lines();
            let request: Value =
                serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
            writer.write_all(format!("{}\n", json!({"id":request["id"], "result":{"thread":{
            "id":"other", "name":null, "preview":"其他任务", "projectId":"project-a",
            "section":null, "status":{"type":"idle"}, "updatedAt":1735689600,
            "model":"wrong-model", "reasoningEffort":"high"
        }}})).as_bytes()).await.unwrap();
        });
    let mut settings = AgentTaskSettings::default();
    let original_model = settings.model.clone();
    assert!(matches!(
        fork_task(&connection, "project-a", "source", None, &mut settings).await,
        Err(ConnectionError::InvalidMessage)
    ));
    assert_eq!(settings.model, original_model);
    server_task.await.unwrap();
}
