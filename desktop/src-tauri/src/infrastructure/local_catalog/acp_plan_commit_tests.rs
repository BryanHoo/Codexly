use super::*;

#[tokio::test]
async fn acp_plan_commit_should_save_definition_resources_and_cursor_together() {
    let root = tempfile::tempdir().unwrap();
    let store = LocalCatalog::at(root.path()).unwrap();
    let mut definition: Value = serde_json::from_str(include_str!(
        "../../../../../tests/fixtures/acp-scheduled-plan-definition.json"
    ))
    .unwrap();
    definition["enabled"] = json!(true);
    let mut request = json!({"source":"desktop","scheduleId":"plan","definition":definition,"resources":[],"expectedRevision":0,"expectedStateRevision":0,"nextRunAt":10});
    let first = store
        .call("acp.plan.commit", request.clone())
        .await
        .unwrap();
    assert_eq!(first["revision"], 1);
    assert_eq!(first["state"]["revision"], 1);
    assert_eq!(first["canEdit"], true);
    assert_eq!(
        store
            .call(
                "acp.plan.view",
                json!({"source":"desktop","scheduleId":"plan"})
            )
            .await
            .unwrap(),
        first
    );
    request["expectedRevision"] = json!(1);
    assert!(
        store
            .call("acp.plan.commit", request.clone())
            .await
            .unwrap()
            .is_null()
    );
    request["expectedStateRevision"] = json!(1);
    request["definition"]["enabled"] = json!(false);
    request["nextRunAt"] = Value::Null;
    let second = store.call("acp.plan.commit", request).await.unwrap();
    assert_eq!(second["revision"], 2);
    assert_eq!(second["state"]["definitionRevision"], 2);
    assert!(second["state"]["nextRunAt"].is_null());
}

#[tokio::test]
async fn acp_plan_commit_should_rollback_resources_on_cursor_error_and_check_state_cas() {
    let root = tempfile::tempdir().unwrap();
    let store = LocalCatalog::at(root.path()).unwrap();
    let mut definition: Value = serde_json::from_str(include_str!(
        "../../../../../tests/fixtures/acp-scheduled-plan-definition.json"
    ))
    .unwrap();
    definition["prompt"]["attachments"] = json!([{"id":"a"}]);
    let key = json!({"source":"desktop","scheduleId":"plan","projectId":"p","token":"old"});
    let mut begin = key.clone();
    begin["attachment"] = json!({"id":"a","kind":"file","mediaType":"x","name":"a","size":1});
    store.call("acp.resource.begin", begin).await.unwrap();
    store
        .append_plan_resource(key.clone(), 0, vec![42])
        .await
        .unwrap();
    store.call("acp.resource.seal", key.clone()).await.unwrap();
    let mut input = json!({"source":"desktop","scheduleId":"plan","definition":definition,"resources":["old"],"expectedRevision":0,"expectedStateRevision":0,"nextRunAt":null});
    let first = store.call("acp.plan.commit", input.clone()).await.unwrap();
    store.with_database(|db| db.execute_batch("CREATE TRIGGER block_cursor BEFORE UPDATE ON acp_plan_state BEGIN SELECT RAISE(ABORT,'cursor failed'); END").map_err(db_error)).unwrap();
    input["expectedRevision"] = json!(1);
    input["expectedStateRevision"] = json!(1);
    input["definition"]["prompt"]["attachments"] = json!([]);
    input["resources"] = json!([]);
    assert!(store.call("acp.plan.commit", input.clone()).await.is_err());
    assert_eq!(
        store.call("acp.plan.view", key.clone()).await.unwrap(),
        first
    );
    assert_eq!(
        store
            .read_plan_resource_chunk(key.clone(), 0)
            .await
            .unwrap(),
        Some(vec![42])
    );
    store
        .with_database(|db| {
            db.execute_batch("DROP TRIGGER block_cursor")
                .map_err(db_error)
        })
        .unwrap();
    store.call("acp.plan.arm",json!({"source":"desktop","scheduleId":"plan","expectedRevision":1,"expectedStateRevision":1,"nextRunAt":null})).await.unwrap();
    assert!(
        store
            .call("acp.plan.commit", input.clone())
            .await
            .unwrap()
            .is_null()
    );
    input["expectedStateRevision"] = json!(2);
    let second = store.call("acp.plan.commit", input).await.unwrap();
    assert_eq!(second["revision"], 2);
    assert_eq!(second["state"]["revision"], 3);
    assert_eq!(second["resources"], json!([]));
}
