use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, duplex, split};

use super::*;

#[test]
fn generated_title_should_normalize_chinese_and_bound_unicode() {
    assert_eq!(
        parse_title(r#"{"title":"  “修复任务\n标题。”  "}"#).unwrap(),
        "修复任务 标题"
    );
    let long = json!({"title": "中".repeat(100)}).to_string();
    assert_eq!(parse_title(&long).unwrap().chars().count(), 36);
    for invalid in [r#"{"title":"   "}"#, "普通回答", r#"{"message":"标题"}"#] {
        assert!(parse_title(invalid).is_err());
    }
    assert!(parse_title(&"x".repeat(8193)).is_err());
    let prompt = title_prompt(&"中".repeat(100_000));
    assert!(prompt.len() < 4096);
    assert!(prompt.ends_with(&"中".repeat(1024)));
}

#[tokio::test]
async fn title_generation_should_use_isolated_structured_turn_and_persist_summary() {
    let (client, server) = duplex(32 * 1024);
    let (reader, writer) = split(client);
    let (server_reader, mut server_writer) = split(server);
    let connection = AppServerConnection::new(reader, writer);
    let server_task = tokio::spawn(async move {
        let mut lines = BufReader::new(server_reader).lines();
        for (method, result) in [
            (
                "config/read",
                json!({"config": {"mcp_servers": {"external": {"enabled": true}}}}),
            ),
            ("thread/start", json!({"thread": {"id": "title-thread"}})),
            ("turn/start", json!({"turn": {"id": "title-turn"}})),
            ("thread/unsubscribe", json!({"status": "unsubscribed"})),
            (
                "thread/read",
                json!({"thread": {
                    "id": "task", "projectId": "project", "name": null,
                    "preview": "请帮我检查一下为什么任务的标题都是第一句话而不是总结",
                }}),
            ),
            ("thread/name/set", json!({})),
        ] {
            let request: Value =
                serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
            assert_eq!(request["method"], method);
            let params = &request["params"];
            match method {
                "thread/start" => {
                    assert_eq!(params["model"], "custom-model");
                    assert_eq!(params["ephemeral"], true);
                    assert_eq!(params["threadSource"], "system");
                    assert_eq!(params["approvalPolicy"], "never");
                    assert_eq!(params["sandbox"], "read-only");
                    assert_eq!(
                        params["config"]["mcp_servers"]["external"]["enabled"],
                        false
                    );
                    assert_eq!(params["config"]["features.shell_tool"], false);
                    assert_eq!(params["config"]["features.hooks"], false);
                    assert_eq!(params["config"]["tools.update_plan.enabled"], true);
                    assert_eq!(params["dynamicTools"], json!([]));
                }
                "turn/start" => {
                    assert_eq!(params["threadId"], "title-thread");
                    assert_eq!(params["outputSchema"]["required"], json!(["title"]));
                    assert!(
                        params["input"][0]["text"]
                            .as_str()
                            .unwrap()
                            .contains("用户请求")
                    );
                    assert!(params.get("effort").is_none());
                }
                "thread/read" => assert_eq!(params["includeTurns"], false),
                "thread/name/set" => {
                    assert_eq!(params["threadId"], "task");
                    assert_eq!(params["name"], "修复任务标题生成");
                }
                "thread/unsubscribe" => assert_eq!(params["threadId"], "title-thread"),
                _ => {}
            }
            server_writer
                .write_all(
                    format!("{}\n", json!({"id": request["id"], "result": result})).as_bytes(),
                )
                .await
                .unwrap();
        }
    });
    let id = start_title_thread(&connection, "/work/project", "custom-model")
        .await
        .unwrap();
    start_title_turn(&connection, &id, &title_prompt("请帮我修复任务标题"))
        .await
        .unwrap();
    release_title_thread(&connection, &id, None).await;
    let title = parse_title(r#"{"title":"修复任务标题生成"}"#).unwrap();
    apply_title(&connection, "project", "task", &title)
        .await
        .unwrap();
    server_task.await.unwrap();
}

#[tokio::test]
async fn automatic_title_should_preserve_manual_name_and_reject_foreign_task() {
    for (thread, should_succeed) in [
        (
            json!({"id": "task", "projectId": "project", "name": "手动标题"}),
            true,
        ),
        (
            json!({"id": "other", "projectId": "project", "name": null}),
            false,
        ),
        (
            json!({"id": "task", "projectId": "other", "name": null}),
            false,
        ),
    ] {
        let (client, server) = duplex(4096);
        let (reader, writer) = split(client);
        let (server_reader, mut server_writer) = split(server);
        let connection = AppServerConnection::new(reader, writer);
        let server_task = tokio::spawn(async move {
            let mut lines = BufReader::new(server_reader).lines();
            let request: Value =
                serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
            assert_eq!(request["method"], "thread/read");
            server_writer
                .write_all(
                    format!(
                        "{}\n",
                        json!({"id": request["id"], "result": {"thread": thread}})
                    )
                    .as_bytes(),
                )
                .await
                .unwrap();
            // 保持连接直至调用结束，任何额外改名请求都会令断言失败。
            assert!(lines.next_line().await.unwrap().is_none());
        });
        assert_eq!(
            apply_title(&connection, "project", "task", "自动标题")
                .await
                .is_ok(),
            should_succeed
        );
        drop(connection);
        server_task.await.unwrap();
    }
}
