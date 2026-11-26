use super::*;
#[tokio::test]
async fn acp_plan_history_should_keep_only_metadata_and_fixed_source() {
    let root = tempfile::tempdir().unwrap();
    let store = LocalCatalog::at(root.path()).unwrap();
    let key = json!({"source":"desktop","scheduleId":"plan"});
    assert!(
        store
            .call("acp.plan.history", key.clone())
            .await
            .unwrap()
            .is_null()
    );
    let mut definition: Value = serde_json::from_str(include_str!(
        "../../../../../tests/fixtures/acp-scheduled-plan-definition.json"
    ))
    .unwrap();
    definition["enabled"] = json!(true);
    store.call("acp.plan.set",json!({"source":"desktop","scheduleId":"plan","definition":definition,"expectedRevision":0})).await.unwrap();
    assert_eq!(
        store.call("acp.plan.history", key.clone()).await.unwrap(),
        json!({"projectId":"p","data":[]})
    );
    store.call("acp.plan.arm",json!({"source":"desktop","scheduleId":"plan","expectedRevision":1,"expectedStateRevision":0,"nextRunAt":10})).await.unwrap();
    store.call("acp.plan.claim",json!({"source":"desktop","scheduleId":"plan","runId":"run","expectedRevision":1,"expectedStateRevision":1,"now":10,"nextRunAt":null})).await.unwrap();
    let history = store.call("acp.plan.history", key).await.unwrap();
    assert_eq!(history["data"][0]["status"], "claimed");
    assert!(history["data"][0].get("definition").is_none());
    assert!(
        store
            .call(
                "acp.plan.history",
                json!({"source":"web","scheduleId":"plan"})
            )
            .await
            .unwrap()
            .is_null()
    );
}

#[tokio::test]
async fn acp_plan_history_should_bound_records_and_keep_unknown_occupied() {
    let root = tempfile::tempdir().unwrap();
    let store = LocalCatalog::at(root.path()).unwrap();
    let mut definition: Value = serde_json::from_str(include_str!(
        "../../../../../tests/fixtures/acp-scheduled-plan-definition.json"
    ))
    .unwrap();
    definition["enabled"] = json!(true);
    store.call("acp.plan.set",json!({"source":"desktop","scheduleId":"plan","definition":definition,"expectedRevision":0})).await.unwrap();
    for i in 0..22 {
        store.call("acp.plan.arm",json!({"source":"desktop","scheduleId":"plan","expectedRevision":1,"expectedStateRevision":i*2,"nextRunAt":10+i})).await.unwrap();
        store.call("acp.plan.claimRef",json!({"source":"desktop","scheduleId":"plan","runId":format!("r{i:02}"),"expectedRevision":1,"expectedStateRevision":i*2+1,"now":10+i,"nextRunAt":null})).await.unwrap();
        store.call("acp.plan.finish",json!({"source":"desktop","scheduleId":"plan","runId":format!("r{i:02}"),"expectedStatus":"claimed","status":if i==21 {"unknown"}else{"started"},"taskId":format!("task/{i}"),"error":if i==21 {json!("connection lost")}else{Value::Null}})).await.unwrap();
    }
    let key = json!({"source":"desktop","scheduleId":"plan"});
    let history = store.call("acp.plan.history", key.clone()).await.unwrap();
    assert_eq!(history["data"].as_array().unwrap().len(), 20);
    assert_eq!(history["data"][0]["runId"], "r21");
    assert_eq!(history["data"][19]["runId"], "r02");
    assert_eq!(history["data"][0]["status"], "unknown");
    assert!(history["data"][0].get("definition").is_none());
    assert!(
        store
            .call("project.read", json!({"id":"p"}))
            .await
            .unwrap()
            .is_null()
    );
    assert_eq!(
        store.call("acp.plan.view", key).await.unwrap()["canEdit"],
        false
    );
    assert_eq!(
        store
            .call(
                "acp.plan.summary",
                json!({"source":"desktop","scheduleId":"plan","runId":"r21"})
            )
            .await
            .unwrap(),
        history["data"][0]
    );
}
