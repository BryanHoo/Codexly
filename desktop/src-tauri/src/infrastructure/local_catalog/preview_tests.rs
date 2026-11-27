use super::*;

fn sample() -> Value {
    json!({"id":"task-preview","projectId":null,"title":"","cwd":"/work","provider":"codex","sessionId":"native-preview","updatedAt":100,"pinned":false,"archived":false,"status":"idle"})
}

#[tokio::test]
async fn background_session_should_be_hidden_by_native_identity_after_reopening() {
    let dir = tempfile::tempdir().unwrap();
    let store = LocalCatalog::at(dir.path()).unwrap();
    store.call("task.put", sample()).await.unwrap();
    let mut chat = sample();
    chat["id"] = json!("claude-chat");
    chat["provider"] = json!("claude");
    store.call("task.put", chat).await.unwrap();
    store
        .call(
            "acp.session.background",
            json!({"engine":"codex","sessionId":"native-preview"}),
        )
        .await
        .unwrap();
    drop(store);
    let reopened = LocalCatalog::at(dir.path()).unwrap();
    let page = reopened
        .task_page(crate::domain::sidebar::ListTasksInput {
            project_id: "temporary".into(),
            ..Default::default()
        })
        .await
        .unwrap();
    assert_eq!(page.data.len(), 1);
    assert_eq!(page.data[0].id, "claude-chat");
    assert!(
        reopened
            .call("task.read", json!({"id":"task-preview"}))
            .await
            .unwrap()
            .is_null()
    );
}

#[tokio::test]
async fn empty_codefree_import_should_reappear_after_native_message() {
    let dir = tempfile::tempdir().unwrap();
    let store = LocalCatalog::at(dir.path()).unwrap();
    let source_path = dir.path().join("codefree.db");
    let source = Connection::open(&source_path).unwrap();
    let title = "New session - 2026-11-27T09:28:27.870Z";
    source
        .execute_batch(
            "CREATE TABLE session (id TEXT PRIMARY KEY, title TEXT);
             CREATE TABLE message (session_id TEXT);",
        )
        .unwrap();
    let mut imported = sample();
    imported["id"] = json!("acp-import-acp-codefree-o-empty");
    imported["provider"] = json!("acp-codefree-o");
    imported["title"] = json!(title);
    store.call("task.put", imported).await.unwrap();
    source
        .execute("INSERT INTO session VALUES ('native-preview', ?)", [title])
        .unwrap();
    let schema = serde_json::from_str(include_str!(
        "../../../../../packages/protocol/src/local-catalog-schema.json"
    ))
    .unwrap();
    let refresh = || {
        store
            .with_database(|db| {
                previews::recover_empty_codefree_sessions(db, &source_path, &schema)
            })
            .unwrap();
    };
    let input = || crate::domain::sidebar::ListTasksInput {
        project_id: "temporary".into(),
        ..Default::default()
    };
    refresh();
    assert!(store.task_page(input()).await.unwrap().data.is_empty());
    source
        .execute("INSERT INTO message VALUES ('native-preview')", [])
        .unwrap();
    refresh();
    let page = store.task_page(input()).await.unwrap();
    assert_eq!(page.data[0].id, "acp-import-acp-codefree-o-empty");
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
