use super::*;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, duplex, split};

#[tokio::test]
async fn generated_task_title_should_publish_persisted_metadata_without_native_rpc() {
    let dir = tempfile::tempdir().unwrap();
    let (client, _server) = duplex(8192);
    let (reader, writer) = split(client);
    let connection = AppServerConnection::with_image_store(reader, writer, dir.path());
    let catalog = connection.catalog.as_ref().unwrap();
    catalog.call("task.put", json!({"id":"task-local","projectId":null,"title":"","cwd":"/work","provider":"codex","sessionId":null,"updatedAt":100,"pinned":false,"archived":false,"status":"notLoaded"})).await.unwrap();
    let mut messages = connection.take_server_messages().await.unwrap();

    super::super::task_title::apply_title(&connection, "temporary", "task-local", "修复左栏标题")
        .await
        .unwrap();
    // 本地名称已经落盘后，左栏必须通过既有事实流立即收到更新，无需刷新或轮询。
    let message = tokio::time::timeout(Duration::from_millis(200), messages.recv())
        .await
        .expect("生成标题落盘后必须发布元数据事件")
        .unwrap();
    let message = connection
        .translate_catalog_message(message)
        .await
        .unwrap()
        .unwrap();
    let event = super::super::map_server_event_now(message, 0)
        .unwrap()
        .unwrap();
    let event = serde_json::to_value(event).unwrap();
    assert_eq!(event["type"], "task.metadata_changed");
    assert_eq!(event["taskId"], "task-local");
    assert_eq!(event["payload"]["title"], "修复左栏标题");
    assert_eq!(
        catalog
            .call("task.read", json!({"id":"task-local"}))
            .await
            .unwrap()["title"],
        "修复左栏标题"
    );

    // 已有名称优先；再次应用自动摘要不能写入或发出覆盖事件。
    super::super::task_title::apply_title(&connection, "temporary", "task-local", "覆盖标题")
        .await
        .unwrap();
    assert!(messages.try_recv().is_err());
    // 原生执行端的名称不能覆盖应用目录权威状态。
    let native = super::super::ServerMessage {
        id: None,
        method: "thread/name/updated".into(),
        params: serde_json::value::to_raw_value(
            &json!({"threadId":"native","threadName":"原生名称"}),
        )
        .unwrap(),
    };
    assert!(
        connection
            .translate_catalog_message(native)
            .await
            .unwrap()
            .is_none()
    );
}

#[tokio::test]
async fn manages_empty_tasks_without_sending_any_rpc() {
    let dir = tempfile::tempdir().unwrap();
    let (client, _server) = duplex(8192);
    let (reader, writer) = split(client);
    let connection = AppServerConnection::with_image_store(reader, writer, dir.path());
    let catalog = connection.catalog.as_ref().unwrap();
    catalog
        .call(
            "project.put",
            json!({"id":"p","name":"项目","path":"/work","createdAt":"2026-10-15T00:00:00Z"}),
        )
        .await
        .unwrap();
    let timeout = Duration::from_millis(200);
    let started: Value = connection
        .request(
            "thread/start",
            &json!({"projectId":"p","cwd":"/work"}),
            timeout,
        )
        .await
        .unwrap();
    let id = started["thread"]["id"].as_str().unwrap();
    assert!(id.starts_with("task-"));
    let _: Value = connection
        .request(
            "thread/name/set",
            &json!({"threadId":id,"name":"本地标题"}),
            timeout,
        )
        .await
        .unwrap();
    let _: Value = connection
        .request("thread/archive", &json!({"threadId":id}), timeout)
        .await
        .unwrap();
    let page: Value = connection
        .request(
            "thread/list",
            &json!({"projectId":"p","archived":true}),
            timeout,
        )
        .await
        .unwrap();
    assert_eq!(page["data"][0]["name"], "本地标题");
    assert_eq!(
        catalog.call("task.read", json!({"id":id})).await.unwrap()["sessionId"],
        Value::Null
    );
}

#[tokio::test]
async fn translates_execution_and_notifications_without_rewriting_text() {
    let dir = tempfile::tempdir().unwrap();
    let (client, server) = duplex(8192);
    let (reader, writer) = split(client);
    let connection = AppServerConnection::with_image_store(reader, writer, dir.path());
    let task = json!({"id":"task-local","projectId":null,"title":"任务","cwd":"/work","provider":"codex","sessionId":"native","updatedAt":100,"pinned":false,"archived":false,"status":"idle"});
    connection
        .catalog
        .as_ref()
        .unwrap()
        .call("task.put", task.clone())
        .await
        .unwrap();
    connection.remember_catalog_task(&task).unwrap();
    let server_task = tokio::spawn(async move {
        let (reader, mut writer) = split(server);
        let mut lines = BufReader::new(reader).lines();
        let req: Value = serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
        assert_eq!(req["params"]["threadId"], "native");
        assert_eq!(req["params"]["text"], "task-local");
        writer
            .write_all(
                format!(
                    "{}\n",
                    json!({"id":req["id"],"result":{"turn":{"id":"turn"}}})
                )
                .as_bytes(),
            )
            .await
            .unwrap();
    });
    let _: Value = connection
        .request(
            "turn/start",
            &json!({"threadId":"task-local","text":"task-local"}),
            Duration::from_secs(2),
        )
        .await
        .unwrap();
    server_task.await.unwrap();
    let message = super::super::ServerMessage {
        id: None,
        method: "item/agentMessage/delta".into(),
        params: serde_json::value::to_raw_value(&json!({"threadId":"native","delta":"native"}))
            .unwrap(),
    };
    let message = connection
        .translate_catalog_message(message)
        .await
        .unwrap()
        .unwrap();
    let value: Value = serde_json::from_str(message.params.get()).unwrap();
    assert_eq!(value["threadId"], "task-local");
    assert_eq!(value["delta"], "native");
}

#[tokio::test]
async fn persists_bound_workspace_after_native_update() {
    let dir = tempfile::tempdir().unwrap();
    let (client, server) = duplex(8192);
    let (reader, writer) = split(client);
    let connection = AppServerConnection::with_image_store(reader, writer, dir.path());
    let catalog = connection.catalog.as_ref().unwrap();
    catalog.call("task.put",json!({"id":"task-local","projectId":null,"title":"分叉","cwd":"/before","provider":"codex","sessionId":"native","updatedAt":100,"pinned":false,"archived":false,"status":"idle"})).await.unwrap();
    let server_task = tokio::spawn(async move {
        let (reader, mut writer) = split(server);
        let mut lines = BufReader::new(reader).lines();
        let req: Value = serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
        assert_eq!(req["params"]["threadId"], "native");
        writer
            .write_all(format!("{}\n", json!({"id":req["id"],"result":{}})).as_bytes())
            .await
            .unwrap();
    });
    let _: Value = connection
        .request(
            "thread/settings/update",
            &json!({"threadId":"task-local","cwd":"/after"}),
            Duration::from_secs(2),
        )
        .await
        .unwrap();
    server_task.await.unwrap();
    assert_eq!(
        catalog
            .call("task.read", json!({"id":"task-local"}))
            .await
            .unwrap()["cwd"],
        "/after"
    );
}
