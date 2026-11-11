use super::*;
fn definition() -> Value {
    serde_json::from_str(include_str!(
        "../../../../../tests/fixtures/acp-scheduled-plan-definition.json"
    ))
    .unwrap()
}
#[tokio::test]
async fn acp_plan_should_isolate_definitions_and_protect_revision_and_project() {
    let root = tempfile::tempdir().unwrap();
    let store = LocalCatalog::at(root.path()).unwrap();
    let key = json!({"source":"desktop","scheduleId":"new-plan"});
    assert!(
        store
            .call("acp.plan.read", key.clone())
            .await
            .unwrap()
            .is_null()
    );
    let result=store.call("acp.plan.set",json!({"source":"desktop","scheduleId":"new-plan","definition":definition(),"expectedRevision":0})).await.unwrap();
    assert_eq!(result["revision"], 1);
    assert_eq!(result["definition"], definition());
    let mut moved = definition();
    moved["projectId"] = json!("other");
    assert!(store.call("acp.plan.set",json!({"source":"desktop","scheduleId":"new-plan","definition":moved,"expectedRevision":1})).await.unwrap().is_null());
    drop(store);
    let store = LocalCatalog::at(root.path()).unwrap();
    assert_eq!(
        store.call("acp.plan.read", key.clone()).await.unwrap()["definition"],
        definition()
    );
    assert_eq!(
        store
            .call(
                "acp.plan.delete",
                json!({"source":"desktop","scheduleId":"new-plan","expectedRevision":0})
            )
            .await
            .unwrap(),
        false
    );
    assert_eq!(
        store
            .call(
                "acp.plan.delete",
                json!({"source":"desktop","scheduleId":"new-plan","expectedRevision":1})
            )
            .await
            .unwrap(),
        true
    );
}

#[tokio::test]
async fn acp_plan_should_reject_shared_invalid_cases_and_oversize_definitions() {
    let root = tempfile::tempdir().unwrap();
    let store = LocalCatalog::at(root.path()).unwrap();
    let patches: Value = serde_json::from_str(include_str!(
        "../../../../../tests/fixtures/acp-scheduled-plan-invalid.json"
    ))
    .unwrap();
    for patch in patches.as_array().unwrap() {
        let mut value = definition();
        for (k, v) in patch.as_object().unwrap() {
            value[k] = v.clone();
        }
        assert!(store.call("acp.plan.set",json!({"source":"desktop","scheduleId":"bad","definition":value,"expectedRevision":0})).await.is_err());
    }
    let mut huge = definition();
    huge["values"] = json!({});
    for i in 0..33 {
        huge["values"][i.to_string()] = json!("x".repeat(16384));
    }
    assert!(store.call("acp.plan.set",json!({"source":"desktop","scheduleId":"bad","definition":huge,"expectedRevision":0})).await.is_err());
    assert!(
        store
            .call(
                "acp.plan.read",
                json!({"source":"desktop","scheduleId":"bad"})
            )
            .await
            .unwrap()
            .is_null()
    );
}
