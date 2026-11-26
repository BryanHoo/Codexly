use super::*;
#[tokio::test]
async fn acp_plan_index_should_project_metadata_and_filter_due_and_busy() {
    let root = tempfile::tempdir().unwrap();
    let store = LocalCatalog::at(root.path()).unwrap();
    let mut definition: Value = serde_json::from_str(include_str!(
        "../../../../../tests/fixtures/acp-scheduled-plan-definition.json"
    ))
    .unwrap();
    definition["enabled"] = json!(true);
    store.call("acp.plan.set",json!({"source":"desktop","scheduleId":"p","definition":definition,"expectedRevision":0})).await.unwrap();
    let page = store
        .call("acp.plan.list", json!({"source":"desktop","limit":10}))
        .await
        .unwrap();
    assert_eq!(page["data"][0]["name"], definition["name"]);
    assert!(page["data"][0].get("prompt").is_none());
    assert_eq!(
        store
            .call(
                "acp.plan.due",
                json!({"source":"desktop","now":10,"limit":10})
            )
            .await
            .unwrap(),
        json!([])
    );
    store.call("acp.plan.arm",json!({"source":"desktop","scheduleId":"p","expectedRevision":1,"expectedStateRevision":0,"nextRunAt":10})).await.unwrap();
    assert_eq!(
        store
            .call(
                "acp.plan.due",
                json!({"source":"desktop","now":10,"limit":10})
            )
            .await
            .unwrap()
            .as_array()
            .unwrap()
            .len(),
        1
    );
    store.call("acp.plan.claim",json!({"source":"desktop","scheduleId":"p","expectedRevision":1,"expectedStateRevision":1,"nextRunAt":20,"now":10,"runId":"r"})).await.unwrap();
    assert_eq!(
        store
            .call(
                "acp.plan.due",
                json!({"source":"desktop","now":30,"limit":10})
            )
            .await
            .unwrap(),
        json!([])
    );
}
