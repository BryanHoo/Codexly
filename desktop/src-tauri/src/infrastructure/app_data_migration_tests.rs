use super::*;
use serde_json::json;

fn seed(path: &Path, project: &str, task: &str, provider: &str) -> Connection {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    let db = Connection::open(path).unwrap();
    db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;")
        .unwrap();
    let schema: Value = serde_json::from_str(include_str!(
        "../../../../packages/protocol/src/local-catalog-schema.json"
    ))
    .unwrap();
    db.execute_batch(schema["sql"].as_str().unwrap()).unwrap();
    db.execute(
        "INSERT INTO managed_projects VALUES (?,?,'/workspace','2026-01-01',0)",
        [project, project],
    )
    .unwrap();
    db.execute(
        "INSERT INTO managed_tasks VALUES (?,?,?,'/workspace',?,?,1,0,0,'idle')",
        [task, project, task, provider, task],
    )
    .unwrap();
    db
}

#[test]
fn migrates_both_wal_sources_and_does_not_resurrect_deleted_tasks() {
    let dir = tempfile::tempdir().unwrap();
    let web = dir.path().join("web");
    let desktop = dir.path().join("desktop");
    let root = dir.path().join(".codexly");
    let _web = seed(
        &web.join("state.sqlite3"),
        "web-project",
        "web-task",
        "codex",
    );
    let _desktop = seed(
        &desktop.join("catalog.sqlite3"),
        "desktop-project",
        "desktop-task",
        "claude",
    );
    fs::write(desktop.join("app.json"), "preferences").unwrap();
    fs::create_dir_all(desktop.join("attachments/desktop-project")).unwrap();
    fs::write(
        desktop.join("attachments/desktop-project/image.png"),
        "image",
    )
    .unwrap();
    fs::write(
        desktop.join("agent-settings.json"),
        r#"{"version":1,"global":{},"projects":{"desktop-project":{"model":"desktop-model"}}}"#,
    )
    .unwrap();
    prepare(&root, &[web.clone(), desktop.clone()]).unwrap();
    assert_eq!(
        fs::read_to_string(root.join("attachments/web-project/image.png")).unwrap(),
        "image"
    );
    let settings: Value =
        serde_json::from_slice(&fs::read(root.join("agent-settings.json")).unwrap()).unwrap();
    assert_eq!(
        settings["projects"]["web-project"]["model"],
        "desktop-model"
    );
    let catalog = crate::infrastructure::local_catalog::LocalCatalog::at(&root).unwrap();
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    runtime.block_on(async {
        let page = catalog.call("task.bindings", Value::Null).await.unwrap();
        assert_eq!(page.as_array().unwrap().len(), 2);
        let task = catalog
            .call("task.read", json!({"id":"desktop-task"}))
            .await
            .unwrap();
        assert_eq!(task["projectId"], "web-project");
        catalog
            .call("task.remove", json!({"id":"desktop-task"}))
            .await
            .unwrap();
    });
    prepare(&root, &[web, desktop]).unwrap();
    runtime.block_on(async {
        assert!(
            catalog
                .call("task.read", json!({"id":"desktop-task"}))
                .await
                .unwrap()
                .is_null()
        );
    });
    assert_eq!(
        fs::read_to_string(root.join("app.json")).unwrap(),
        "preferences"
    );
}

#[test]
fn first_launch_waits_for_a_writer_before_enabling_wal() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("state.sqlite3");
    let writer = Connection::open(&path).unwrap();
    writer
        .execute_batch(
            "CREATE TABLE probe (id INTEGER); BEGIN IMMEDIATE; INSERT INTO probe VALUES (1);",
        )
        .unwrap();
    std::thread::scope(|scope| {
        let (sent, received) = std::sync::mpsc::channel();
        let root = dir.path();
        scope.spawn(move || sent.send(prepare(root, &[])).unwrap());
        let early = received.recv_timeout(Duration::from_millis(100));
        writer.execute_batch("COMMIT").unwrap();
        assert!(
            matches!(early, Err(std::sync::mpsc::RecvTimeoutError::Timeout)),
            "migration must wait for the writer: {early:?}"
        );
        received
            .recv_timeout(Duration::from_secs(5))
            .unwrap()
            .unwrap();
    });
    assert_eq!(
        writer
            .query_row("SELECT COUNT(*) FROM probe", [], |row| row.get::<_, i64>(0))
            .unwrap(),
        1
    );
}

#[test]
fn concurrent_first_launches_publish_one_database_without_losing_commits() {
    let dir = tempfile::tempdir().unwrap();
    let web = dir.path().join("web");
    let root = dir.path().join(".codexly");
    let _web = seed(&web.join("state.sqlite3"), "p", "t", "codex");
    std::thread::scope(|scope| {
        let one = scope.spawn(|| prepare(&root, std::slice::from_ref(&web)));
        let two = scope.spawn(|| prepare(&root, std::slice::from_ref(&web)));
        one.join().unwrap().unwrap();
        two.join().unwrap().unwrap();
    });
    let db = Connection::open(root.join("state.sqlite3")).unwrap();
    assert_eq!(
        db.query_row("SELECT COUNT(*) FROM managed_tasks", [], |row| row
            .get::<_, i64>(0))
            .unwrap(),
        1
    );
}
