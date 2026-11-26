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

#[tokio::test]
async fn scheduled_acp_delete_should_remove_only_source_config() {
    let (root, runtime, saved) = fixture().await;
    let store = LocalCatalog::at(root.path()).unwrap();
    for source in ["web", "desktop"] {
        store.call("acp.schedule.set",json!({"source":source,"scheduleId":saved.id,"engine":"codex","values":{"mode":false},"expectedRevision":0})).await.unwrap();
    }
    runtime.delete(root.path(), &saved.id).await.unwrap();
    assert!(
        store
            .call(
                "acp.schedule.read",
                json!({"source":"desktop","scheduleId":saved.id})
            )
            .await
            .unwrap()
            .is_null()
    );
    assert_eq!(
        store
            .call(
                "acp.schedule.read",
                json!({"source":"web","scheduleId":saved.id})
            )
            .await
            .unwrap()["revision"],
        1
    );
    assert!(
        ScheduledTaskRuntime::default()
            .list(root.path())
            .await
            .unwrap()
            .is_empty()
    );
}

#[tokio::test]
async fn scheduled_acp_delete_should_recover_both_json_commit_boundaries() {
    for removed in [false, true] {
        let (root, _runtime, saved) = fixture().await;
        let store = LocalCatalog::at(root.path()).unwrap();
        let key = json!({"source":"desktop","scheduleId":saved.id});
        store.call("acp.schedule.set",json!({"source":"desktop","scheduleId":saved.id,"engine":"claude","values":{"mode":false},"expectedRevision":0})).await.unwrap();
        store
            .call("acp.schedule.retire", key.clone())
            .await
            .unwrap();
        if removed {
            write_scheduled_tasks(root.path(), &[]).await.unwrap();
        }
        let tasks = ScheduledTaskRuntime::default()
            .list(root.path())
            .await
            .unwrap();
        assert_eq!(tasks.is_empty(), removed);
        assert_eq!(
            store
                .call("acp.schedule.read", key)
                .await
                .unwrap()
                .is_null(),
            removed
        );
        assert_eq!(
            store
                .call("acp.schedule.retirements", json!({"source":"desktop"}))
                .await
                .unwrap(),
            json!([])
        );
    }
}

#[tokio::test]
async fn scheduled_acp_delete_should_defer_failed_cleanup_until_restart() {
    let (root, runtime, saved) = fixture().await;
    let store = LocalCatalog::at(root.path()).unwrap();
    let key = json!({"source":"desktop","scheduleId":saved.id});
    store.call("acp.schedule.set",json!({"source":"desktop","scheduleId":saved.id,"engine":"codex","values":{},"expectedRevision":0})).await.unwrap();
    let db = rusqlite::Connection::open(root.path().join("state.sqlite3")).unwrap();
    let version: i64 = db
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap();
    db.execute_batch("CREATE TRIGGER stop_acp_cleanup BEFORE DELETE ON acp_scheduled_configs BEGIN SELECT RAISE(ABORT,'injected cleanup failure'); END;").unwrap();
    runtime.delete(root.path(), &saved.id).await.unwrap();
    assert!(read_scheduled_tasks(root.path()).await.unwrap().is_empty());
    assert_eq!(
        store.call("acp.schedule.read", key.clone()).await.unwrap()["revision"],
        1
    );
    assert_eq!(
        store
            .call("acp.schedule.retirements", json!({"source":"desktop"}))
            .await
            .unwrap()
            .as_array()
            .unwrap()
            .len(),
        1
    );
    db.execute_batch("DROP TRIGGER stop_acp_cleanup").unwrap();
    assert!(
        ScheduledTaskRuntime::default()
            .list(root.path())
            .await
            .unwrap()
            .is_empty()
    );
    assert!(
        store
            .call("acp.schedule.read", key)
            .await
            .unwrap()
            .is_null()
    );
    assert_eq!(
        db.query_row::<i64, _, _>("PRAGMA user_version", [], |row| row.get(0))
            .unwrap(),
        version
    );
}

#[tokio::test]
async fn scheduled_acp_delete_should_preserve_config_when_json_commit_fails() {
    let (root, runtime, saved) = fixture().await;
    let store = LocalCatalog::at(root.path()).unwrap();
    let key = json!({"source":"desktop","scheduleId":saved.id});
    store.call("acp.schedule.set",json!({"source":"desktop","scheduleId":saved.id,"engine":"codex","values":{},"expectedRevision":0})).await.unwrap();
    let before = std::fs::read(root.path().join("scheduled-tasks/v1.json")).unwrap();
    // 只替换测试运行时的写入目的地，原文件保持可读，模拟磁盘发布失败。
    let blocked = root.path().join("blocked");
    std::fs::write(&blocked, b"not a directory").unwrap();
    runtime.inner.lock().await.app_data = Some(blocked);
    assert!(runtime.delete(root.path(), &saved.id).await.is_err());
    assert_eq!(
        std::fs::read(root.path().join("scheduled-tasks/v1.json")).unwrap(),
        before
    );
    assert_eq!(
        store.call("acp.schedule.read", key.clone()).await.unwrap()["revision"],
        1
    );
    assert_eq!(
        ScheduledTaskRuntime::default()
            .list(root.path())
            .await
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        store.call("acp.schedule.read", key).await.unwrap()["revision"],
        1
    );
    assert_eq!(
        store
            .call("acp.schedule.retirements", json!({"source":"desktop"}))
            .await
            .unwrap(),
        json!([])
    );
}

#[tokio::test]
async fn scheduled_acp_delete_should_not_remove_newer_config_after_interruption() {
    let (root, _runtime, saved) = fixture().await;
    let store = LocalCatalog::at(root.path()).unwrap();
    let key = json!({"source":"desktop","scheduleId":saved.id});
    for revision in [0, 1] {
        store.call("acp.schedule.set",json!({"source":"desktop","scheduleId":saved.id,"engine":"codex","values":{},"expectedRevision":revision})).await.unwrap();
        if revision == 0 {
            store
                .call("acp.schedule.retire", key.clone())
                .await
                .unwrap();
        }
    }
    write_scheduled_tasks(root.path(), &[]).await.unwrap();
    ScheduledTaskRuntime::default()
        .list(root.path())
        .await
        .unwrap();
    assert_eq!(
        store.call("acp.schedule.read", key).await.unwrap()["revision"],
        2
    );
    assert_eq!(
        store
            .call("acp.schedule.retirements", json!({"source":"desktop"}))
            .await
            .unwrap(),
        json!([])
    );
}
