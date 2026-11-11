use super::*;

#[tokio::test]
async fn acp_plan_scan_should_reject_corrupt_reference_claim_without_advancing() {
    let root = tempfile::tempdir().unwrap();
    let store = LocalCatalog::at(root.path()).unwrap();
    let mut definition: Value = serde_json::from_str(include_str!(
        "../../../../../tests/fixtures/acp-scheduled-plan-definition.json"
    ))
    .unwrap();
    definition["enabled"] = json!(true);
    store.call("acp.plan.set",json!({"source":"desktop","scheduleId":"plan","expectedRevision":0,"definition":definition})).await.unwrap();
    store.call("acp.plan.arm",json!({"source":"desktop","scheduleId":"plan","expectedRevision":1,"expectedStateRevision":0,"nextRunAt":10})).await.unwrap();
    let db = Connection::open(root.path().join("state.sqlite3")).unwrap();
    db.execute_batch("UPDATE acp_scheduled_plans SET definition_json=json_set(definition_json,'$.prompt.text',42)").unwrap();
    assert!(store.call("acp.plan.claimRef",json!({"source":"desktop","scheduleId":"plan","runId":"run","expectedRevision":1,"expectedStateRevision":1,"now":10,"nextRunAt":null})).await.is_err());
    assert_eq!(
        store
            .call(
                "acp.plan.readState",
                json!({"source":"desktop","scheduleId":"plan"})
            )
            .await
            .unwrap()["revision"],
        1
    );
    assert!(
        store
            .call(
                "acp.plan.readRun",
                json!({"source":"desktop","scheduleId":"plan","runId":"run"})
            )
            .await
            .unwrap()
            .is_null()
    );
}

#[tokio::test]
async fn acp_plan_scan_should_claim_reference_and_keep_snapshot() {
    let root = tempfile::tempdir().unwrap();
    let store = LocalCatalog::at(root.path()).unwrap();
    let mut definition: Value = serde_json::from_str(include_str!(
        "../../../../../tests/fixtures/acp-scheduled-plan-definition.json"
    ))
    .unwrap();
    definition["enabled"] = json!(true);
    store.call("acp.plan.set",json!({"source":"desktop","scheduleId":"plan","expectedRevision":0,"definition":definition})).await.unwrap();
    store.call("acp.plan.arm",json!({"source":"desktop","scheduleId":"plan","expectedRevision":1,"expectedStateRevision":0,"nextRunAt":10})).await.unwrap();
    assert_eq!(store.call("acp.plan.claimRef",json!({"source":"desktop","scheduleId":"plan","runId":"run","expectedRevision":1,"expectedStateRevision":1,"now":10,"nextRunAt":null})).await.unwrap(),json!({"scheduleId":"plan","runId":"run"}));
    assert_eq!(
        store
            .call(
                "acp.plan.readRun",
                json!({"source":"desktop","scheduleId":"plan","runId":"run"})
            )
            .await
            .unwrap()["definition"],
        definition
    );
}

#[tokio::test]
async fn acp_plan_scan_should_page_unresolved_and_find_future_eligible_time() {
    let root = tempfile::tempdir().unwrap();
    let store = LocalCatalog::at(root.path()).unwrap();
    let mut definition: Value = serde_json::from_str(include_str!(
        "../../../../../tests/fixtures/acp-scheduled-plan-definition.json"
    ))
    .unwrap();
    definition["enabled"] = json!(true);
    for (id, time) in [("a", 10), ("b", 20), ("c", 30)] {
        store.call("acp.plan.set",json!({"source":"desktop","scheduleId":id,"expectedRevision":0,"definition":definition})).await.unwrap();
        store.call("acp.plan.arm",json!({"source":"desktop","scheduleId":id,"expectedRevision":1,"expectedStateRevision":0,"nextRunAt":time})).await.unwrap();
    }
    for id in ["a", "b"] {
        store.call("acp.plan.claim",json!({"source":"desktop","scheduleId":id,"runId":format!("run-{id}"),"expectedRevision":1,"expectedStateRevision":1,"now":20,"nextRunAt":null})).await.unwrap();
    }
    assert_eq!(
        store
            .call("acp.plan.active", json!({"source":"desktop","limit":1}))
            .await
            .unwrap(),
        json!({"data":[{"scheduleId":"a","runId":"run-a"}],"nextCursor":"a"})
    );
    assert_eq!(
        store
            .call(
                "acp.plan.active",
                json!({"source":"desktop","limit":1,"after":"a"})
            )
            .await
            .unwrap(),
        json!({"data":[{"scheduleId":"b","runId":"run-b"}],"nextCursor":null})
    );
    assert_eq!(
        store
            .call("acp.plan.nextDue", json!({"source":"desktop","after":0}))
            .await
            .unwrap(),
        30
    );
    assert!(
        store
            .call("acp.plan.nextDue", json!({"source":"desktop","after":30}))
            .await
            .unwrap()
            .is_null()
    );
    assert_eq!(
        store
            .call("acp.plan.active", json!({"source":"web","limit":100}))
            .await
            .unwrap()["data"],
        json!([])
    );
}
