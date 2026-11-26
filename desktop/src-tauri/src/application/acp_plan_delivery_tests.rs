use super::*;
use crate::{
    application::{acp_plan_service::AcpPlanService, error::AppError},
    infrastructure::local_catalog::LocalCatalog,
};
use serde_json::{Value, json};
use tokio_util::sync::CancellationToken;
#[tokio::test]
async fn acp_plan_delivery_should_fix_source_and_reject_unknown_fields() {
    let root = tempfile::tempdir().unwrap();
    let catalog = LocalCatalog::at(root.path()).unwrap();
    let service = AcpPlanService::new(root.path(), catalog.clone(), || {});
    let cancel = CancellationToken::new();
    let mut definition: Value = serde_json::from_str(include_str!(
        "../../../../tests/fixtures/acp-scheduled-plan-definition.json"
    ))
    .unwrap();
    definition["projectId"] = json!("temporary");
    let body = json!({"type":"save","planId":"plan","input":{"definition":definition,"resources":[],"expectedRevision":0,"expectedStateRevision":0}});
    let saved = deliver(
        &service,
        &catalog,
        body,
        |_, _, _| async { panic!("disabled draft") },
        &cancel,
    )
    .await
    .unwrap();
    assert_eq!(saved["source"], "desktop");
    let page = deliver(
        &service,
        &catalog,
        json!({"type":"list","limit":1}),
        |_, _, _| async { panic!("read must not preview") },
        &cancel,
    )
    .await
    .unwrap();
    assert_eq!(page["data"][0]["scheduleId"], "plan");
    assert!(page["data"][0].get("prompt").is_none());
    let history = deliver(
        &service,
        &catalog,
        json!({"type":"history","planId":"plan"}),
        |_, _, _| async { panic!("history must not preview") },
        &cancel,
    )
    .await
    .unwrap();
    assert_eq!(history, json!({"projectId":"temporary","data":[]}));
    assert!(matches!(
        deliver(
            &service,
            &catalog,
            json!({"type":"history","planId":"missing"}),
            |_, _, _| async { panic!("history must not preview") },
            &cancel
        )
        .await,
        Err(AppError::ScheduledTaskNotFound)
    ));
    for request in [
        json!({"type":"list","source":"web"}),
        json!({"type":"list","limit":101}),
        json!({"type":"list","limit":null}),
        json!({"type":"list","after":null}),
        json!({"type":"read","planId":"plan","cwd":"/injected"}),
        json!({"type":"read","planId":""}),
        json!({"type":"history","planId":"plan","source":"web"}),
    ] {
        assert!(matches!(
            deliver(
                &service,
                &catalog,
                request,
                |_, _, _| async { panic!("invalid") },
                &cancel
            )
            .await,
            Err(AppError::ScheduledTaskInvalid)
        ));
    }
    let conflict = deliver(
        &service,
        &catalog,
        json!({"type":"delete","planId":"plan","expectedRevision":2}),
        |_, _, _| async { panic!("delete") },
        &cancel,
    )
    .await;
    assert!(matches!(
        conflict,
        Err(AppError::ScheduledTaskConfigConflict)
    ));
    assert_eq!(
        deliver(
            &service,
            &catalog,
            json!({"type":"delete","planId":"plan","expectedRevision":1}),
            |_, _, _| async { panic!("delete") },
            &cancel
        )
        .await
        .unwrap(),
        json!({"deleted":true})
    );
    assert!(
        catalog
            .call("acp.plan.read", json!({"source":"web","scheduleId":"plan"}))
            .await
            .unwrap()
            .is_null()
    );
}

#[tokio::test]
async fn acp_plan_delivery_should_stage_project_uploads_and_cancel_without_writes() {
    let root = tempfile::tempdir().unwrap();
    let catalog = LocalCatalog::at(root.path()).unwrap();
    let service = AcpPlanService::new(root.path(), catalog.clone(), || {});
    let cancel = CancellationToken::new();
    let upload = crate::infrastructure::workspace::store_attachment(
        root.path(),
        "temporary",
        "text",
        "a.txt",
        b"hello",
    )
    .await
    .unwrap();
    let attachment = serde_json::to_value(upload).unwrap()["attachment"].clone();
    let resource = deliver(
        &service,
        &catalog,
        json!({"type":"stage","planId":"plan","projectId":"temporary","attachment":attachment}),
        |_, _, _| async { panic!("stage") },
        &cancel,
    )
    .await
    .unwrap();
    let mut definition: Value = serde_json::from_str(include_str!(
        "../../../../tests/fixtures/acp-scheduled-plan-definition.json"
    ))
    .unwrap();
    definition["projectId"] = json!("temporary");
    definition["prompt"]["attachments"] = json!([{"id":resource["attachment"]["id"]}]);
    let saved=deliver(&service,&catalog,json!({"type":"save","planId":"plan","input":{"definition":definition,"resources":[resource["token"]],"expectedRevision":0,"expectedStateRevision":0}}),|_,_,_|async{panic!("disabled")},&cancel).await.unwrap();
    assert_eq!(saved["resources"].as_array().unwrap().len(), 1);
    let foreign = deliver(
        &service,
        &catalog,
        json!({"type":"stage","planId":"plan","projectId":"foreign","attachment":attachment}),
        |_, _, _| async { panic!("stage") },
        &cancel,
    )
    .await;
    assert!(matches!(
        foreign,
        Err(AppError::ScheduledTaskConfigConflict)
    ));
    cancel.cancel();
    assert!(matches!(
        deliver(
            &service,
            &catalog,
            json!({"type":"delete","planId":"plan","expectedRevision":1}),
            |_, _, _| async { panic!("cancelled") },
            &cancel
        )
        .await,
        Err(AppError::RequestCancelled)
    ));
    assert_eq!(service.read("plan").await.unwrap(), saved);
    assert!(
        tokio::fs::try_exists(attachment["id"].as_str().unwrap())
            .await
            .unwrap()
    );
}
