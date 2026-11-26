use super::*;

fn resource_key(token: &str) -> Value {
    json!({"source":"desktop","scheduleId":"plan","projectId":"p","token":token})
}

fn resource_definition(id: &str) -> Value {
    let mut definition: Value = serde_json::from_str(include_str!(
        "../../../../../tests/fixtures/acp-scheduled-plan-definition.json"
    ))
    .unwrap();
    definition["prompt"]["attachments"] = json!([{ "id":id }]);
    definition
}

async fn stage_resource(store: &LocalCatalog, token: &str, id: &str) {
    let mut input = resource_key(token);
    input["attachment"] = json!({"id":id,"kind":"file","mediaType":"application/octet-stream","name":"file","size":1});
    store.call("acp.resource.begin", input).await.unwrap();
    store
        .append_plan_resource(resource_key(token), 0, vec![42])
        .await
        .unwrap();
    store
        .call("acp.resource.seal", resource_key(token))
        .await
        .unwrap();
}

async fn save_resource(
    store: &LocalCatalog,
    token: &str,
    id: &str,
    revision: i64,
) -> Result<Value, CatalogError> {
    store.call("acp.plan.save", json!({"source":"desktop","scheduleId":"plan","definition":resource_definition(id),"expectedRevision":revision,"resources":[token]})).await
}
#[tokio::test]
async fn acp_resource_should_preserve_binary_and_bind_atomically() {
    let root = tempfile::tempdir().unwrap();
    let store = LocalCatalog::at(root.path()).unwrap();
    let key = json!({"source":"desktop","scheduleId":"plan","projectId":"p","token":"token"});
    let mut begin = key.clone();
    begin["attachment"] = json!({"id":"a","kind":"file","mediaType":"application/octet-stream","name":"a.bin","size":4});
    store.call("acp.resource.begin", begin).await.unwrap();
    store
        .append_plan_resource(key.clone(), 0, vec![0, 255])
        .await
        .unwrap();
    assert_eq!(
        store
            .append_plan_resource(key.clone(), 0, vec![0, 255])
            .await
            .unwrap(),
        2
    );
    assert!(store.call("acp.resource.seal", key.clone()).await.is_err());
    store
        .append_plan_resource(key.clone(), 2, vec![128, 1])
        .await
        .unwrap();
    assert!(store.call("acp.resource.seal", key.clone()).await.unwrap()["digest"].is_string());
    let mut definition: Value = serde_json::from_str(include_str!(
        "../../../../../tests/fixtures/acp-scheduled-plan-definition.json"
    ))
    .unwrap();
    definition["prompt"]["attachments"] = json!([{ "id":"a" }]);
    assert_eq!(store.call("acp.plan.save",json!({"source":"desktop","scheduleId":"plan","definition":definition,"expectedRevision":0,"resources":["token"]})).await.unwrap()["revision"],1);
    drop(store);
    let store = LocalCatalog::at(root.path()).unwrap();
    assert_eq!(
        store
            .read_plan_resource_chunk(key.clone(), 0)
            .await
            .unwrap(),
        Some(vec![0, 255])
    );
    let mut foreign = key;
    foreign["projectId"] = json!("other");
    assert!(store.read_plan_resource_chunk(foreign, 0).await.is_err());
}

#[tokio::test]
async fn acp_resource_should_rollback_binding_and_cascade_delete() {
    let root = tempfile::tempdir().unwrap();
    let store = LocalCatalog::at(root.path()).unwrap();
    stage_resource(&store, "old", "a").await;
    stage_resource(&store, "new", "b").await;
    save_resource(&store, "old", "a", 0).await.unwrap();
    let db = Connection::open(root.path().join("state.sqlite3")).unwrap();
    let version: i64 = db
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .unwrap();
    // 在更新定义之后故意中断资源绑定，验证事务同时恢复定义、索引和旧资源。
    db.execute_batch("CREATE TRIGGER block_bind BEFORE UPDATE ON acp_plan_resources WHEN OLD.bound_source IS NULL AND NEW.bound_source IS NOT NULL BEGIN SELECT RAISE(ABORT,'bind failed'); END;").unwrap();
    assert!(save_resource(&store, "new", "b", 1).await.is_err());
    let saved = store
        .call("acp.plan.read", resource_key("old"))
        .await
        .unwrap();
    assert_eq!(saved["revision"], 1);
    assert_eq!(
        saved["definition"]["prompt"]["attachments"],
        json!([{"id":"a"}])
    );
    assert_eq!(
        store
            .read_plan_resource_chunk(resource_key("old"), 0)
            .await
            .unwrap(),
        Some(vec![42])
    );
    db.execute_batch("DROP TRIGGER block_bind").unwrap();
    assert_eq!(
        save_resource(&store, "new", "b", 1).await.unwrap()["revision"],
        2
    );
    assert!(
        store
            .read_plan_resource_chunk(resource_key("old"), 0)
            .await
            .is_err()
    );
    assert!(
        save_resource(&store, "new", "b", 1)
            .await
            .unwrap()
            .is_null()
    );
    let mut query = resource_key("new");
    query["expectedRevision"] = json!(2);
    assert_eq!(
        store
            .call("acp.resource.list", query.clone())
            .await
            .unwrap()
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(store.call("acp.plan.delete", query).await.unwrap(), true);
    assert!(
        store
            .read_plan_resource_chunk(resource_key("new"), 0)
            .await
            .is_err()
    );
    let remaining: i64 = db
        .query_row("SELECT COUNT(*) FROM acp_plan_resource_chunks", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(remaining, 0);
    assert_eq!(
        db.pragma_query_value::<i64, _>(None, "user_version", |r| r.get(0))
            .unwrap(),
        version
    );
}

#[tokio::test]
async fn acp_resource_should_reject_invalid_bytes_and_scope() {
    let root = tempfile::tempdir().unwrap();
    let store = LocalCatalog::at(root.path()).unwrap();
    let key = resource_key("text");
    let mut input = key.clone();
    input["attachment"] =
        json!({"id":"a","kind":"text","mediaType":"text/plain","name":"a.txt","size":1});
    store.call("acp.resource.begin", input).await.unwrap();
    assert!(
        store
            .append_plan_resource(key.clone(), 1, vec![1])
            .await
            .is_err()
    );
    assert!(
        store
            .append_plan_resource(key.clone(), 0, vec![0; 262145])
            .await
            .is_err()
    );
    store
        .append_plan_resource(key.clone(), 0, vec![255])
        .await
        .unwrap();
    assert!(
        store
            .append_plan_resource(key.clone(), 0, vec![1])
            .await
            .is_err()
    );
    assert!(store.call("acp.resource.seal", key).await.is_err());
    stage_resource(&store, "file", "b").await;
    let mut foreign = resource_key("file");
    foreign["source"] = json!("web");
    assert!(store.read_plan_resource_chunk(foreign, 0).await.is_err());
    assert!(save_resource(&store, "file", "wrong-ref", 0).await.is_err());
    // 私有数据库中的块被破坏后，读取必须报错，不能交付不完整内容。
    let db = Connection::open(root.path().join("state.sqlite3")).unwrap();
    db.execute(
        "UPDATE acp_plan_resource_chunks SET content=x'00' WHERE token='file'",
        [],
    )
    .unwrap();
    assert!(
        store
            .read_plan_resource_chunk(resource_key("file"), 0)
            .await
            .is_err()
    );
}
