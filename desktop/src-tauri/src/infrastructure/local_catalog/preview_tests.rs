use super::*;

fn sample() -> Value {
    json!({"id":"task-preview","projectId":null,"title":"","cwd":"/work","provider":"codex","sessionId":"native-preview","updatedAt":100,"pinned":false,"archived":false,"status":"idle"})
}

#[tokio::test]
async fn first_preview_should_survive_reopening_without_blocking_generated_names() {
    let dir = tempfile::tempdir().unwrap();
    let store = LocalCatalog::at(dir.path()).unwrap();
    store.call("task.put", sample()).await.unwrap();
    store
        .call(
            "task.preview",
            json!({"id":"task-preview","preview":"  修复重启标题\n后续行"}),
        )
        .await
        .unwrap();
    store
        .call(
            "task.preview",
            json!({"id":"task-preview","preview":"后续消息"}),
        )
        .await
        .unwrap();
    drop(store);
    let reopened = LocalCatalog::at(dir.path()).unwrap();
    let page = reopened
        .task_page(crate::domain::sidebar::ListTasksInput {
            project_id: "temporary".into(),
            search_term: Some("重启".into()),
            ..Default::default()
        })
        .await
        .unwrap();
    assert_eq!(page.data.len(), 1);
    assert_eq!(page.data[0].title, "修复重启标题");
    let raw = reopened
        .call("task.read", json!({"id":"task-preview"}))
        .await
        .unwrap();
    assert_eq!(raw["title"], "");
    assert_eq!(raw["updatedAt"], 100.0);
    reopened
        .call(
            "task.patch",
            json!({"id":"task-preview","title":"正式标题"}),
        )
        .await
        .unwrap();
    assert_eq!(
        reopened
            .task_page(crate::domain::sidebar::ListTasksInput {
                project_id: "temporary".into(),
                ..Default::default()
            })
            .await
            .unwrap()
            .data[0]
            .title,
        "正式标题"
    );
}

#[tokio::test]
async fn legacy_preview_recovery_should_use_session_binding_and_preserve_local_metadata() {
    let dir = tempfile::tempdir().unwrap();
    let store = LocalCatalog::at(dir.path()).unwrap();
    let mut task = sample();
    task["archived"] = json!(true);
    task["pinned"] = json!(true);
    store.call("task.put", task).await.unwrap();
    let source_path = dir.path().join("native.sqlite");
    let source = Connection::open(&source_path).unwrap();
    source.execute_batch("CREATE TABLE threads (id TEXT PRIMARY KEY, preview TEXT NOT NULL); INSERT INTO threads VALUES ('native-preview','恢复旧预览');").unwrap();
    drop(source);
    let input = json!({"databasePath":source_path});
    assert_eq!(
        store
            .call("task.recoverPreviews", input.clone())
            .await
            .unwrap(),
        1
    );
    assert_eq!(store.call("task.recoverPreviews", input).await.unwrap(), 0);
    let task = store
        .call("task.read", json!({"id":"task-preview"}))
        .await
        .unwrap();
    assert_eq!(task["title"], "");
    assert_eq!(task["preview"], "恢复旧预览");
    assert_eq!(task["archived"], true);
    assert_eq!(task["pinned"], true);
    assert_eq!(task["updatedAt"], 100.0);
}
