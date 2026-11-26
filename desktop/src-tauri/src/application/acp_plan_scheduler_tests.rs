use super::*;
use serde_json::json;
use std::sync::{Arc, Mutex};

#[tokio::test]
async fn acp_scheduler_should_recover_before_due_and_isolate_errors() {
    let root = tempfile::tempdir().unwrap();
    let store = LocalCatalog::at(root.path()).unwrap();
    let mut definition: Value = serde_json::from_str(include_str!(
        "../../../../tests/fixtures/acp-scheduled-plan-definition.json"
    ))
    .unwrap();
    definition["enabled"] = json!(true);
    for id in ["a-active", "b-claimed", "c-bad", "d-due", "e-future"] {
        definition["schedule"] = if id == "c-bad" {
            json!({"type":"rrule","rrule":"invalid","timezone":"UTC","startAtUnixMs":1})
        } else {
            json!({"type":"once","atUnixMs":if id=="e-future" {200}else{10}})
        };
        store.call("acp.plan.set",json!({"source":"desktop","scheduleId":id,"expectedRevision":0,"definition":definition})).await.unwrap();
        store.call("acp.plan.arm",json!({"source":"desktop","scheduleId":id,"expectedRevision":1,"expectedStateRevision":0,"nextRunAt":if id=="e-future" {200}else{10}})).await.unwrap();
        if id == "a-active" || id == "b-claimed" {
            store.call("acp.plan.claim",json!({"source":"desktop","scheduleId":id,"runId":id,"expectedRevision":1,"expectedStateRevision":1,"now":10,"nextRunAt":null})).await.unwrap();
        }
    }
    store.call("acp.plan.finish",json!({"source":"desktop","scheduleId":"a-active","runId":"a-active","expectedStatus":"claimed","status":"unknown","taskId":null,"error":"pending"})).await.unwrap();
    let calls = Arc::new(Mutex::new(Vec::new()));
    let capture = calls.clone();
    let catalog = store.clone();
    let mut execute = move |id: String, run: String| {
        let catalog = catalog.clone();
        let capture = capture.clone();
        async move {
            capture.lock().unwrap().push(id.clone());
            if id == "a-active" {
                return Err(AppError::AcpSubmissionUnknown);
            }
            Ok(catalog.call("acp.plan.finish",json!({"source":"desktop","scheduleId":id,"runId":run,"expectedStatus":"claimed","status":"failed","taskId":null,"error":"proof"})).await?)
        }
    };
    let mut cursor = Some(Scan::Recovery(None));
    let mut errors = Vec::new();
    for _ in 0..10 {
        let Some(next) = cursor.take() else {
            break;
        };
        let result = scan(&store, &mut execute, 10, next, 1, &CancellationToken::new())
            .await
            .unwrap();
        errors.extend(result.errors.into_iter().map(|e| e["scheduleId"].clone()));
        cursor = result.next;
    }
    assert!(cursor.is_none());
    assert_eq!(
        *calls.lock().unwrap(),
        vec!["a-active", "b-claimed", "d-due"]
    );
    assert_eq!(errors, vec![json!("a-active"), json!("c-bad")]);
}
