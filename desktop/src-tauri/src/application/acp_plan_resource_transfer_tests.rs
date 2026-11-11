use super::*;
use serde_json::json;

#[tokio::test]
async fn acp_plan_restore_should_remove_caches_on_digest_failure_and_reject_stale_scope() {
    let root = tempfile::tempdir().unwrap();
    let catalog = LocalCatalog::at(root.path()).unwrap();
    let cancel = CancellationToken::new();
    let mut resources = Vec::new();
    for name in ["first.txt", "second.txt"] {
        let uploaded = workspace::store_attachment(root.path(), "p", "text", name, name.as_bytes())
            .await
            .unwrap();
        let attachment = serde_json::to_value(uploaded).unwrap()["attachment"].clone();
        resources.push(
            stage(root.path(), &catalog, "plan", "p", &attachment, &cancel)
                .await
                .unwrap(),
        );
    }
    resources.reverse();
    let mut definition: Value = serde_json::from_str(include_str!(
        "../../../../tests/fixtures/acp-scheduled-plan-definition.json"
    ))
    .unwrap();
    definition["prompt"]["attachments"] = json!(
        resources
            .iter()
            .map(|r| json!({"id":r["attachment"]["id"]}))
            .collect::<Vec<_>>()
    );
    let plan = catalog.call("acp.plan.save",json!({"source":"desktop","scheduleId":"plan","expectedRevision":0,"definition":definition,"resources":resources.iter().map(|r|r["token"].clone()).collect::<Vec<_>>()})).await.unwrap();
    let restored = restore(root.path(), &catalog, &plan, "task", &cancel)
        .await
        .unwrap();
    assert_eq!(restored.input["attachments"][0]["name"], "second.txt");
    assert_eq!(restored.input["attachments"][1]["name"], "first.txt");
    restored.discard().await.unwrap();
    let mut invalid = plan.clone();
    invalid["revision"] = json!(2);
    assert!(
        restore(root.path(), &catalog, &invalid, "task", &cancel)
            .await
            .is_err()
    );
    invalid = plan.clone();
    invalid["definition"]["projectId"] = json!("other");
    assert!(
        restore(root.path(), &catalog, &invalid, "task", &cancel)
            .await
            .is_err()
    );
    let db = rusqlite::Connection::open(root.path().join("state.sqlite3")).unwrap();
    db.execute(
        "UPDATE acp_plan_resources SET digest=? WHERE token=?",
        rusqlite::params!["0".repeat(64), resources[1]["token"].as_str()],
    )
    .unwrap();
    assert!(
        restore(root.path(), &catalog, &plan, "task", &cancel)
            .await
            .is_err()
    );
    let parent = root
        .path()
        .join("attachments")
        .join(crate::infrastructure::queued_media::scope("task"));
    assert!(
        tokio::fs::read_dir(&parent)
            .await
            .unwrap()
            .next_entry()
            .await
            .unwrap()
            .is_none()
    );
    cancel.cancel();
    assert!(matches!(
        restore(root.path(), &catalog, &plan, "task", &cancel).await,
        Err(AppError::RequestCancelled)
    ));
    assert_eq!(
        catalog
            .call(
                "acp.plan.read",
                json!({"source":"desktop","scheduleId":"plan"})
            )
            .await
            .unwrap(),
        plan
    );
}

#[tokio::test]
async fn acp_plan_restore_should_survive_restart_and_use_task_authorization() {
    let root = tempfile::tempdir().unwrap();
    let mut catalog = LocalCatalog::at(root.path()).unwrap();
    let uploaded = workspace::store_attachment(root.path(), "p", "text", "proof.txt", b"proof")
        .await
        .unwrap();
    let attachment = serde_json::to_value(uploaded).unwrap()["attachment"].clone();
    let cancel = CancellationToken::new();
    let resource = stage(root.path(), &catalog, "plan", "p", &attachment, &cancel)
        .await
        .unwrap();
    let mut definition: Value = serde_json::from_str(include_str!(
        "../../../../tests/fixtures/acp-scheduled-plan-definition.json"
    ))
    .unwrap();
    definition["prompt"]["attachments"] = json!([{"id":resource["attachment"]["id"]}]);
    let plan = catalog.call("acp.plan.save",json!({"source":"desktop","scheduleId":"plan","expectedRevision":0,"definition":definition,"resources":[resource["token"]]})).await.unwrap();
    tokio::fs::remove_file(attachment["id"].as_str().unwrap())
        .await
        .unwrap();
    drop(catalog);
    catalog = LocalCatalog::at(root.path()).unwrap();
    let first = restore(root.path(), &catalog, &plan, "task", &cancel)
        .await
        .unwrap();
    assert!(
        super::super::acp_input::prepare(root.path(), "p", "other-task", first.input.clone())
            .await
            .is_err()
    );
    let second = restore(root.path(), &catalog, &plan, "task", &cancel)
        .await
        .unwrap();
    assert_ne!(
        first.input["attachments"][0]["id"],
        second.input["attachments"][0]["id"]
    );
    let (prepared, refs) =
        super::super::acp_input::prepare(root.path(), "p", "task", first.input.clone())
            .await
            .unwrap();
    assert!(refs.is_empty());
    let input = super::super::acp_input::provider_input(prepared)
        .await
        .unwrap();
    assert_eq!(input["textAttachments"][0]["text"], "proof");
    let cached = first.input["attachments"][0]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    first.discard().await.unwrap();
    second.discard().await.unwrap();
    assert!(!tokio::fs::try_exists(cached).await.unwrap());
    assert_eq!(
        catalog
            .call(
                "acp.plan.read",
                json!({"source":"desktop","scheduleId":"plan"})
            )
            .await
            .unwrap(),
        plan
    );
}

#[tokio::test]
async fn acp_plan_upload_should_remove_partial_chunks_after_storage_failure() {
    let root = tempfile::tempdir().unwrap();
    let catalog = LocalCatalog::at(root.path()).unwrap();
    // 首次调用初始化私有表，故障注入只影响第二块写入。
    catalog
        .call("acp.plan.list", json!({"source":"desktop","limit":1}))
        .await
        .unwrap();
    let db = rusqlite::Connection::open(root.path().join("state.sqlite3")).unwrap();
    db.execute_batch("CREATE TRIGGER fail_second_chunk BEFORE INSERT ON acp_plan_resource_chunks WHEN NEW.offset>0 BEGIN SELECT RAISE(ABORT,'disk failure'); END;").unwrap();
    let uploaded =
        workspace::store_attachment(root.path(), "p", "file", "a.bin", &vec![42; 300000])
            .await
            .unwrap();
    let attachment = serde_json::to_value(uploaded).unwrap()["attachment"].clone();
    assert!(
        stage(
            root.path(),
            &catalog,
            "plan",
            "p",
            &attachment,
            &CancellationToken::new()
        )
        .await
        .is_err()
    );
    for table in ["acp_plan_resources", "acp_plan_resource_chunks"] {
        assert_eq!(
            db.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }
    assert!(
        tokio::fs::try_exists(attachment["id"].as_str().unwrap())
            .await
            .unwrap()
    );
}

#[tokio::test]
async fn acp_plan_upload_should_reject_external_paths_size_and_bad_text() {
    let root = tempfile::tempdir().unwrap();
    let catalog = LocalCatalog::at(root.path()).unwrap();
    let uploaded = workspace::store_attachment(root.path(), "p", "file", "a.bin", &[255])
        .await
        .unwrap();
    let attachment = serde_json::to_value(uploaded).unwrap()["attachment"].clone();
    let cancel = CancellationToken::new();
    let mut invalid = attachment.clone();
    invalid["size"] = json!(2);
    assert!(
        stage(root.path(), &catalog, "plan", "p", &invalid, &cancel)
            .await
            .is_err()
    );
    invalid["size"] = json!(1);
    invalid["id"] = json!(root.path().join("outside.txt"));
    tokio::fs::write(root.path().join("outside.txt"), [255])
        .await
        .unwrap();
    assert!(
        stage(root.path(), &catalog, "plan", "p", &invalid, &cancel)
            .await
            .is_err()
    );
    invalid = attachment.clone();
    invalid["kind"] = json!("text");
    invalid["mediaType"] = json!("text/plain");
    assert!(
        stage(root.path(), &catalog, "plan", "p", &invalid, &cancel)
            .await
            .is_err()
    );
    cancel.cancel();
    assert!(matches!(
        stage(root.path(), &catalog, "plan", "p", &attachment, &cancel).await,
        Err(AppError::RequestCancelled)
    ));
    let db = rusqlite::Connection::open(root.path().join("state.sqlite3")).unwrap();
    assert_eq!(
        db.query_row("SELECT COUNT(*) FROM acp_plan_resources", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        0
    );
}

#[tokio::test]
async fn acp_plan_upload_should_stage_authorized_bytes_without_storing_paths() {
    let root = tempfile::tempdir().unwrap();
    let catalog = LocalCatalog::at(root.path()).unwrap();
    let mut bytes = vec![255; 300000];
    bytes[0] = 0;
    let uploaded = crate::infrastructure::workspace::store_attachment(
        root.path(),
        "p",
        "file",
        "a.bin",
        &bytes,
    )
    .await
    .unwrap();
    let attachment = serde_json::to_value(uploaded).unwrap()["attachment"].clone();
    let cancel = CancellationToken::new();
    let resource = stage(root.path(), &catalog, "plan", "p", &attachment, &cancel)
        .await
        .unwrap();
    assert_ne!(resource["attachment"]["id"], attachment["id"]);
    assert!(!Path::new(resource["attachment"]["id"].as_str().unwrap()).is_absolute());
    assert_eq!(resource["written"], 300000);
    let key =
        json!({"source":"desktop","scheduleId":"plan","projectId":"p","token":resource["token"]});
    let mut saved = catalog
        .read_plan_resource_chunk(key.clone(), 0)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(saved.len(), 262144);
    saved.extend(
        catalog
            .read_plan_resource_chunk(key, saved.len() as i64)
            .await
            .unwrap()
            .unwrap(),
    );
    assert_eq!(saved, bytes);
    assert!(
        stage(root.path(), &catalog, "plan", "other", &attachment, &cancel)
            .await
            .is_err()
    );
    assert!(
        tokio::fs::try_exists(attachment["id"].as_str().unwrap())
            .await
            .unwrap()
    );
}
