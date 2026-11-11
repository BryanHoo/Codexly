use super::*;
#[tokio::test]
async fn acp_plan_state_should_claim_once_and_preserve_unknown_on_restart() {
    let root = tempfile::tempdir().unwrap();
    let store = LocalCatalog::at(root.path()).unwrap();
    let mut definition: Value = serde_json::from_str(include_str!(
        "../../../../../tests/fixtures/acp-scheduled-plan-definition.json"
    ))
    .unwrap();
    definition["enabled"] = json!(true);
    let key = json!({"source":"desktop","scheduleId":"new"});
    store.call("acp.plan.set",json!({"source":"desktop","scheduleId":"new","definition":definition,"expectedRevision":0})).await.unwrap();
    assert_eq!(store.call("acp.plan.arm",json!({"source":"desktop","scheduleId":"new","expectedRevision":1,"expectedStateRevision":0,"nextRunAt":10})).await.unwrap()["revision"],1);
    let claim = json!({"source":"desktop","scheduleId":"new","expectedRevision":1,"expectedStateRevision":1,"runId":"run","now":10,"nextRunAt":20});
    assert_eq!(
        store.call("acp.plan.claim", claim.clone()).await.unwrap()["status"],
        "claimed"
    );
    assert!(store.call("acp.plan.claim", claim).await.unwrap().is_null());
    assert_eq!(
        store.call("acp.plan.readState", key.clone()).await.unwrap()["nextRunAt"],
        20
    );
    assert_eq!(
        store
            .call(
                "acp.plan.delete",
                json!({"source":"desktop","scheduleId":"new","expectedRevision":1})
            )
            .await
            .unwrap(),
        false
    );
    store.call("acp.plan.finish",json!({"source":"desktop","scheduleId":"new","runId":"run","expectedStatus":"claimed","status":"unknown","taskId":null,"error":"lost"})).await.unwrap();
    drop(store);
    let store = LocalCatalog::at(root.path()).unwrap();
    assert_eq!(
        store
            .call(
                "acp.plan.readRun",
                json!({"source":"desktop","scheduleId":"new","runId":"run"})
            )
            .await
            .unwrap()["definition"],
        definition
    );
    assert!(store.call("acp.plan.claim",json!({"source":"desktop","scheduleId":"new","expectedRevision":1,"expectedStateRevision":2,"runId":"retry","now":20,"nextRunAt":30})).await.unwrap().is_null());
    let result=store.call("acp.plan.finish",json!({"source":"desktop","scheduleId":"new","runId":"run","expectedStatus":"unknown","status":"started","taskId":"task","error":null})).await.unwrap();
    assert!(result["definition"].is_null());
    assert_eq!(result["status"], "started");
    assert_eq!(store.call("acp.plan.claim",json!({"source":"desktop","scheduleId":"new","expectedRevision":1,"expectedStateRevision":2,"runId":"next","now":20,"nextRunAt":30})).await.unwrap()["status"],"claimed");
}

#[tokio::test]
async fn acp_plan_state_should_rollback_cursor_for_corrupt_definition() {
    let root = tempfile::tempdir().unwrap();
    let store = LocalCatalog::at(root.path()).unwrap();
    let mut definition: Value = serde_json::from_str(include_str!(
        "../../../../../tests/fixtures/acp-scheduled-plan-definition.json"
    ))
    .unwrap();
    definition["enabled"] = json!(true);
    store.call("acp.plan.set",json!({"source":"desktop","scheduleId":"bad","definition":definition,"expectedRevision":0})).await.unwrap();
    store.call("acp.plan.arm",json!({"source":"desktop","scheduleId":"bad","expectedRevision":1,"expectedStateRevision":0,"nextRunAt":10})).await.unwrap();
    definition["engine"] = json!("invalid");
    let db = rusqlite::Connection::open(root.path().join("state.sqlite3")).unwrap();
    db.execute(
        "UPDATE acp_scheduled_plans SET definition_json=?",
        [definition.to_string()],
    )
    .unwrap();
    assert!(store.call("acp.plan.claim",json!({"source":"desktop","scheduleId":"bad","expectedRevision":1,"expectedStateRevision":1,"runId":"run","now":10,"nextRunAt":20})).await.is_err());
    let state = store
        .call(
            "acp.plan.readState",
            json!({"source":"desktop","scheduleId":"bad"}),
        )
        .await
        .unwrap();
    assert_eq!(state["revision"], 1);
    assert_eq!(state["nextRunAt"], 10);
}
