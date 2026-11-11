use super::*;

#[tokio::test]
async fn acp_completion_should_recover_known_intent_and_guard_terminal_state() {
    let root = tempfile::tempdir().unwrap();
    let mut store = LocalCatalog::at(root.path()).unwrap();
    let key = json!({"source":"desktop","scheduleId":"plan","runId":"run"});
    let mut definition: Value = serde_json::from_str(include_str!(
        "../../../../../tests/fixtures/acp-scheduled-plan-definition.json"
    ))
    .unwrap();
    definition["enabled"] = json!(true);
    store.call("acp.plan.set",json!({"source":"desktop","scheduleId":"plan","expectedRevision":0,"definition":definition})).await.unwrap();
    store.call("acp.plan.arm",json!({"source":"desktop","scheduleId":"plan","expectedRevision":1,"expectedStateRevision":0,"nextRunAt":10})).await.unwrap();
    store.call("acp.plan.claim",json!({"source":"desktop","scheduleId":"plan","runId":"run","expectedRevision":1,"expectedStateRevision":1,"now":10,"nextRunAt":null})).await.unwrap();
    store.call("acp.plan.finish",json!({"source":"desktop","scheduleId":"plan","runId":"run","expectedStatus":"claimed","status":"unknown","taskId":null,"error":"pending"})).await.unwrap();
    let intent = json!({"source":"desktop","scheduleId":"plan","runId":"run","projectId":"p","status":"started","taskId":"task","error":null});
    assert_eq!(
        store
            .call("acp.plan.completion.put", intent.clone())
            .await
            .unwrap(),
        intent
    );
    drop(store);
    store = LocalCatalog::at(root.path()).unwrap();
    assert_eq!(
        store
            .call("acp.plan.completion.read", key.clone())
            .await
            .unwrap(),
        intent
    );
    let mut wrong = intent.clone();
    wrong["status"] = json!("failed");
    wrong["error"] = json!("wrong");
    assert!(
        store
            .call("acp.plan.completion.put", wrong.clone())
            .await
            .unwrap()
            .is_null()
    );
    wrong["expectedStatus"] = json!("unknown");
    assert!(store.call("acp.plan.finish", wrong).await.is_err());
    let mut finish = intent;
    finish["expectedStatus"] = json!("unknown");
    assert_eq!(
        store.call("acp.plan.finish", finish).await.unwrap()["status"],
        "started"
    );
    assert!(
        store
            .call("acp.plan.completion.read", key)
            .await
            .unwrap()
            .is_null()
    );
}
