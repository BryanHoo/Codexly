use super::*;
use crate::application::error::AppError;
use crate::infrastructure::local_catalog::LocalCatalog;
use serde_json::{Value, json};
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};
use tokio_util::sync::CancellationToken;
fn input() -> Value {
    let mut definition: Value = serde_json::from_str(include_str!(
        "../../../../tests/fixtures/acp-scheduled-plan-definition.json"
    ))
    .unwrap();
    definition["projectId"] = json!("temporary");
    definition["enabled"] = json!(true);
    definition["schedule"] = json!({"type":"once","atUnixMs":1000});
    json!({"definition":definition,"resources":[],"expectedRevision":0,"expectedStateRevision":0})
}
async fn setup() -> (tempfile::TempDir, AcpPlanService, Arc<AtomicUsize>) {
    let root = tempfile::tempdir().unwrap();
    tokio::fs::create_dir_all(root.path().join("temporary-workspaces"))
        .await
        .unwrap();
    let wake = Arc::new(AtomicUsize::new(0));
    let count = wake.clone();
    let service = AcpPlanService::new(
        root.path(),
        LocalCatalog::at(root.path()).unwrap(),
        move || {
            count.fetch_add(1, Ordering::SeqCst);
        },
    );
    (root, service, wake)
}
#[tokio::test]
async fn acp_plan_service_should_preview_raw_config_and_preserve_completed_once() {
    let (_root, service, wake) = setup().await;
    let cancel = CancellationToken::new();
    let first = service
        .save(
            "plan",
            input(),
            |project, engine, values| async move {
                assert_eq!(project, "temporary");
                assert_eq!(engine, "claude");
                assert_eq!(values, json!({"mode":false}));
                Ok(json!({"configOptions":[{"id":"mode","currentValue":false}]}))
            },
            || 100,
            &cancel,
        )
        .await
        .unwrap();
    assert_eq!(first["state"]["nextRunAt"], 1000);
    assert_eq!(wake.load(Ordering::SeqCst), 1);
    service.catalog.call("acp.plan.arm",json!({"source":"desktop","scheduleId":"plan","expectedRevision":1,"expectedStateRevision":1,"nextRunAt":null})).await.unwrap();
    let mut edit = input();
    edit["expectedRevision"] = json!(1);
    edit["expectedStateRevision"] = json!(2);
    edit["definition"]["name"] = json!("重命名");
    let second = service
        .save(
            "plan",
            edit,
            |_, _, _| async { panic!("unchanged config must not preview") },
            || 2000,
            &cancel,
        )
        .await
        .unwrap();
    assert!(second["state"]["nextRunAt"].is_null());
    assert_eq!(second["revision"], 2);
}
#[tokio::test]
async fn acp_plan_service_should_allow_offline_draft_and_reject_paths_and_changed_roots() {
    let (root, service, wake) = setup().await;
    let cancel = CancellationToken::new();
    let mut draft = input();
    draft["definition"]["enabled"] = json!(false);
    draft["definition"]["schedule"]["atUnixMs"] = json!(1);
    let saved = service
        .save(
            "draft",
            draft,
            |_, _, _| async { panic!("disabled draft must not preview") },
            || 100,
            &cancel,
        )
        .await
        .unwrap();
    assert!(saved["state"]["nextRunAt"].is_null());
    let mut invalid = input();
    invalid["cwd"] = json!("/injected");
    assert!(matches!(
        service
            .save(
                "invalid",
                invalid,
                |_, _, _| async { panic!("invalid request") },
                || 100,
                &cancel
            )
            .await,
        Err(AppError::ScheduledTaskInvalid)
    ));
    let directory = root.path().to_owned();
    assert!(matches!(
        service
            .save(
                "changed",
                input(),
                move |_, _, _| async move {
                    let other = directory.join("other");
                    tokio::fs::create_dir(&other).await.unwrap();
                    crate::infrastructure::temporary_workspace_settings::save_root(
                        &directory, &other,
                    )
                    .await
                    .unwrap();
                    Ok(json!({"configOptions":[{"id":"mode","currentValue":false}]}))
                },
                || 100,
                &cancel
            )
            .await,
        Err(AppError::ScheduledTaskConfigConflict)
    ));
    assert!(service.read("changed").await.unwrap().is_null());
    assert_eq!(wake.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn acp_plan_service_should_reject_cursor_races_cancel_and_keep_ended_rules() {
    let (_root, service, wake) = setup().await;
    let cancel = CancellationToken::new();
    service
        .save(
            "plan",
            input(),
            |_, _, _| async { Ok(json!({"configOptions":[{"id":"mode","currentValue":false}]})) },
            || 100,
            &cancel,
        )
        .await
        .unwrap();
    let mut edit = input();
    edit["expectedRevision"] = json!(1);
    edit["expectedStateRevision"] = json!(1);
    edit["definition"]["values"]["mode"] = json!(true);
    let ledger = service.catalog.clone();
    let result=service.save("plan",edit,move|_,_,_|async move {
        ledger.call("acp.plan.arm",json!({"source":"desktop","scheduleId":"plan","expectedRevision":1,"expectedStateRevision":1,"nextRunAt":null})).await?;
        Ok(json!({"configOptions":[{"id":"mode","currentValue":true}]}))
    },||100,&cancel).await;
    assert!(matches!(result, Err(AppError::ScheduledTaskConfigConflict)));
    let view = service.read("plan").await.unwrap();
    assert_eq!(view["revision"], 1);
    assert_eq!(view["state"]["revision"], 2);
    let stop = CancellationToken::new();
    stop.cancel();
    assert!(matches!(
        service
            .save(
                "cancel",
                input(),
                |_, _, _| async { panic!("cancelled") },
                || 100,
                &stop
            )
            .await,
        Err(AppError::RequestCancelled)
    ));
    assert!(service.read("cancel").await.unwrap().is_null());
    assert_eq!(wake.load(Ordering::SeqCst), 1);
    let mut ended = input();
    ended["definition"]["schedule"] =
        json!({"type":"rrule","startAtUnixMs":0,"rrule":"FREQ=DAILY;COUNT=1","timezone":"UTC"});
    let view = service
        .save(
            "ended",
            ended,
            |_, _, _| async { Ok(json!({"configOptions":[{"id":"mode","currentValue":false}]})) },
            || 100,
            &cancel,
        )
        .await
        .unwrap();
    assert!(view["state"]["nextRunAt"].is_null());
}

#[tokio::test]
async fn acp_plan_service_should_stage_authorized_resources_and_delete_orphan_plan() {
    let (root, service, wake) = setup().await;
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
    let resource = service
        .stage("draft", "temporary", &attachment, &cancel)
        .await
        .unwrap();
    let mut draft = input();
    draft["definition"]["enabled"] = json!(false);
    draft["definition"]["prompt"]["attachments"] = json!([{"id":resource["attachment"]["id"]}]);
    draft["resources"] = json!([resource["token"]]);
    let saved = service
        .save(
            "draft",
            draft,
            |_, _, _| async { panic!("disabled") },
            || 100,
            &cancel,
        )
        .await
        .unwrap();
    assert_eq!(saved["resources"].as_array().unwrap().len(), 1);
    assert!(matches!(
        service
            .stage("draft", "foreign", &attachment, &cancel)
            .await,
        Err(AppError::ScheduledTaskConfigConflict)
    ));
    tokio::fs::remove_dir_all(root.path().join("temporary-workspaces"))
        .await
        .unwrap();
    assert_eq!(service.read("draft").await.unwrap(), saved);
    assert!(!service.delete("draft", 2).await.unwrap());
    assert!(service.delete("draft", 1).await.unwrap());
    assert!(service.read("draft").await.unwrap().is_null());
    assert_eq!(wake.load(Ordering::SeqCst), 2);
    assert!(
        tokio::fs::try_exists(attachment["id"].as_str().unwrap())
            .await
            .unwrap()
    );
}
