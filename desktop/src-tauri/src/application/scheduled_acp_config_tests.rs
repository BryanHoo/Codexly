use super::*;
use crate::{domain::conversation::AgentPromptInput, infrastructure::local_catalog::LocalCatalog};
use serde_json::{Value, json};

async fn fixture() -> (tempfile::TempDir, ScheduledTaskRuntime, ScheduledTask) {
    let root = tempfile::tempdir().unwrap();
    let runtime = ScheduledTaskRuntime::default();
    let input = ScheduledTaskInput {
        enabled: false,
        name: "Saved plan".into(),
        project_id: "p".into(),
        project_name: "Project".into(),
        prompt: AgentPromptInput::text("original"),
        schedule: ScheduledTaskSchedule::Once {
            at_unix_ms: 2_000_000_000_000,
        },
        turn_options: Default::default(),
    };
    let saved = runtime.create(root.path(), input).await.unwrap();
    (root, runtime, saved)
}
fn request() -> Value {
    json!({"projectId":"p","engine":"claude","values":{"mode":false},"expectedRevision":0,"confirmMigration":true})
}
fn checked(values: Value) -> Value {
    json!({"values":values,"configOptions":[{"id":"mode","type":"boolean","name":"Mode","currentValue":values["mode"]}]})
}

#[tokio::test]
async fn scheduled_acp_config_should_save_confirmed_values_without_changing_old_plan() {
    let (root, runtime, saved) = fixture().await;
    let path = root.path().join("scheduled-tasks/v1.json");
    let before = std::fs::read(&path).unwrap();
    assert_eq!(
        runtime
            .read_acp_scheduled_config(root.path(), &saved.id)
            .await
            .unwrap(),
        json!({"projectId":"p","canEdit":true,"config":null})
    );
    let data = runtime
        .save_acp_scheduled_config(
            root.path(),
            &saved.id,
            request(),
            |project, engine, values| async move {
                assert_eq!(project, "p");
                assert_eq!(engine, "claude");
                Ok(checked(values))
            },
        )
        .await
        .unwrap();
    assert_eq!(data["config"]["revision"], 1);
    assert_eq!(data["config"]["values"], json!({"mode":false}));
    assert_eq!(std::fs::read(path).unwrap(), before);
    let replay = ScheduledTaskRuntime::default()
        .save_acp_scheduled_config(root.path(), &saved.id, request(), |_, _, _| async {
            panic!("saved values must be confirmed without a preview")
        })
        .await
        .unwrap();
    assert_eq!(replay["config"]["revision"], 1);
}

#[tokio::test]
async fn scheduled_acp_config_should_reject_unconfirmed_or_foreign_and_stale_requests() {
    let (root, runtime, saved) = fixture().await;
    let mut unconfirmed = request();
    unconfirmed["confirmMigration"] = json!(false);
    assert!(
        runtime
            .save_acp_scheduled_config(root.path(), &saved.id, unconfirmed, |_, _, _| async {
                panic!("unconfirmed preview")
            })
            .await
            .is_err()
    );
    runtime
        .save_acp_scheduled_config(root.path(), &saved.id, request(), |_, _, v| async {
            Ok(checked(v))
        })
        .await
        .unwrap();
    for request in [
        json!({"projectId":"other","engine":"claude","values":{"mode":true},"expectedRevision":1}),
        json!({"projectId":"p","engine":"claude","values":{"mode":true},"expectedRevision":0,"confirmMigration":true}),
    ] {
        assert!(
            runtime
                .save_acp_scheduled_config(root.path(), &saved.id, request, |_, _, _| async {
                    panic!("stale preview")
                })
                .await
                .is_err()
        );
    }
}

#[tokio::test]
async fn scheduled_acp_config_preview_should_leave_runtime_unlocked_and_recheck_project() {
    let (root, runtime, saved) = fixture().await;
    let previewed = std::sync::atomic::AtomicBool::new(false);
    let result = tokio::time::timeout(
        Duration::from_secs(2),
        runtime.save_acp_scheduled_config(
            root.path(),
            &saved.id,
            request(),
            |_, _, values| async {
                previewed.store(true, Ordering::Release);
                let current = runtime.list(root.path()).await?;
                assert_eq!(current[0].id, saved.id);
                runtime
                    .update(
                        root.path(),
                        &saved.id,
                        ScheduledTaskInput {
                            enabled: false,
                            name: saved.name.clone(),
                            project_id: "moved".into(),
                            project_name: "Moved".into(),
                            prompt: saved.prompt.clone(),
                            schedule: saved.schedule.clone(),
                            turn_options: saved.turn_options.clone(),
                        },
                    )
                    .await?;
                Ok(checked(values))
            },
        ),
    )
    .await
    .expect("preview must release the scheduler lock");
    assert!(result.is_err());
    assert!(previewed.load(Ordering::Acquire));
    assert!(
        LocalCatalog::at(root.path())
            .unwrap()
            .call(
                "acp.schedule.read",
                json!({"source":"desktop","scheduleId":saved.id})
            )
            .await
            .unwrap()
            .is_null()
    );
}
