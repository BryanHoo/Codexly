use super::*;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, duplex, split};

#[tokio::test]
async fn queued_image_frame_should_use_the_bounded_media_budget() {
    let frame = format!(
        "{{\"result\":{{\"url\":\"data:image/png;base64,{}\"}}}}\n",
        "A".repeat(256)
    );
    // 小预算精确覆盖读取分块跨过 data:image 标记的情况，无需构造巨型附件。
    let mut reader = BufReader::with_capacity(7, frame.as_bytes());
    let mut received = Vec::new();
    let result =
        super::super::connection::read_bounded_frame(&mut reader, &mut received, 64, 512).await;
    assert!(
        matches!(result, Ok(true)),
        "queued image frame was rejected: {result:?}"
    );
    assert_eq!(received, frame.trim_end().as_bytes());
    let mut reader = BufReader::new(frame.as_bytes());
    assert!(
        super::super::connection::read_bounded_frame(&mut reader, &mut Vec::new(), 64, 128)
            .await
            .is_err()
    );
}

#[tokio::test]
async fn queued_image_snapshot_should_support_add_list_and_resubmission() {
    let root = std::env::temp_dir().join(format!(
        "codeagent-queue-image-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let (client, server) = duplex(16 * 1024);
    let (reader, writer) = split(client);
    let connection = AppServerConnection::with_image_store(reader, writer, &root);
    let server_task = tokio::spawn(async move {
        let (reader, mut writer) = split(server);
        let mut lines = BufReader::new(reader).lines();
        // Codex 入队时将 localImage 快照为 image，响应不再返回原始路径。
        let submission = json!({
            "id":"queue-image", "clientUserMessageId":"message-image",
            "input":[
                {"type":"text", "text":"检查图片", "text_elements":[]},
                {"type":"image", "url":"data:image/png;base64,iVBORw0KGgo=", "detail":"original"}
            ]
        });
        for method in ["thread/queue/add", "thread/queue/list"] {
            let request: Value =
                serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
            assert_eq!(request["method"], method);
            let result = if method.ends_with("add") {
                json!({"queuedSubmission":submission})
            } else {
                json!({"data":[submission], "nextCursor":null})
            };
            writer
                .write_all(format!("{}\n", json!({"id":request["id"],"result":result})).as_bytes())
                .await
                .unwrap();
        }
    });
    let original = crate::infrastructure::workspace::store_attachment(
        &root,
        "project-a",
        "image",
        "screenshot.png",
        b"\x89PNG\r\n\x1a\n",
    )
    .await
    .unwrap();
    let input = AgentPromptInput {
        text: "检查图片".into(),
        skills: vec![],
        attachments: vec![serde_json::to_value(original.attachment).unwrap()],
    };
    let added = add_queued_submission(&connection, "thread-a", &input, "message-image")
        .await
        .expect("snapshotted image should not turn a successful add into an error");
    let listed = list_queued_submissions(&connection, "thread-a", None, None)
        .await
        .unwrap();
    assert_eq!(added.queued_submission.text, "检查图片");
    assert_eq!(
        added.queued_submission.attachments,
        listed.data[0].attachments
    );
    let attachment = &added.queued_submission.attachments[0];
    assert_eq!(attachment["detail"], "original");
    assert_eq!(
        std::fs::read(attachment["id"].as_str().unwrap()).unwrap(),
        b"\x89PNG\r\n\x1a\n"
    );
    assert!(!serde_json::to_string(&added).unwrap().contains("base64"));
    let mut resend = AgentPromptInput {
        text: added.queued_submission.text,
        skills: vec![],
        attachments: added.queued_submission.attachments,
    };
    crate::application::attachment_commands::resolve_prompt_attachments(
        &root,
        "project-a",
        "thread-a",
        &mut resend,
    )
    .await
    .unwrap();
    assert_eq!(map_prompt_input(&resend).unwrap()[1]["type"], "localImage");
    assert!(
        crate::application::attachment_commands::resolve_prompt_attachments(
            &root,
            "project-a",
            "thread-b",
            &mut resend
        )
        .await
        .is_err()
    );
    server_task.await.unwrap();
    std::fs::remove_dir_all(root).unwrap();
}
