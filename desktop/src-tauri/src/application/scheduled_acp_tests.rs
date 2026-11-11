use super::*;
use crate::infrastructure::local_catalog::LocalCatalog;
use serde_json::json;

async fn fixture(completed: bool) -> (tempfile::TempDir, LocalCatalog, ScheduledTask, String) {
    let root = tempfile::tempdir().unwrap();
    let catalog = LocalCatalog::at(root.path()).unwrap();
    catalog.call("project.put", json!({"id":"p","name":"Project","path":root.path().to_string_lossy(),"createdAt":"2026-11-11"})).await.unwrap();
    let mut task = build_task(
        "plan".into(),
        ScheduledTaskInput {
            enabled: true,
            name: "Plan".into(),
            project_id: "p".into(),
            project_name: "Project".into(),
            prompt: crate::domain::conversation::AgentPromptInput::text("scheduled proof"),
            schedule: ScheduledTaskSchedule::Once {
                at_unix_ms: 2_000_000_000_000,
            },
            turn_options: Default::default(),
        },
        1,
    )
    .unwrap();
    task.runs.push(ScheduledTaskRun {
        id: "proof-run".into(),
        status: ScheduledTaskRunStatus::Running,
        task_id: None,
        error: None,
        started_at_unix_ms: 2,
        finished_at_unix_ms: None,
    });
    task.last_run_status = Some(ScheduledTaskRunStatus::Running);
    let created = crate::application::acp_task_creation::create(
        root.path(),
        &catalog,
        "p",
        "claude",
        "scheduled:proof-run",
    )
    .await
    .unwrap();
    let task_id = created["id"].as_str().unwrap().to_owned();
    let mut request = json!({"projectId":"p","taskId":task_id,"key":"scheduled:proof-run","fingerprint":"original-body"});
    catalog
        .call("acp.submission.begin", request.clone())
        .await
        .unwrap();
    if completed {
        request["result"] = json!({"id":"confirmed-turn","status":"running"});
        catalog
            .call("acp.submission.complete", request)
            .await
            .unwrap();
    }
    write_scheduled_tasks(root.path(), &[task.clone()])
        .await
        .unwrap();
    (root, catalog, task, task_id)
}

#[tokio::test]
async fn scheduled_acp_restart_should_restore_confirmed_task_without_current_config() {
    let (root, _, _, id) = fixture(true).await;
    let tasks = ScheduledTaskRuntime::default()
        .list(root.path())
        .await
        .unwrap();
    assert!(matches!(
        tasks[0].runs[0].status,
        ScheduledTaskRunStatus::Started
    ));
    assert_eq!(tasks[0].runs[0].task_id.as_deref(), Some(id.as_str()));
}

#[tokio::test]
async fn scheduled_acp_restart_should_disable_unknown_launch_and_keep_task_identity() {
    let (root, _, task, id) = fixture(false).await;
    let runtime = ScheduledTaskRuntime::default();
    let tasks = runtime.list(root.path()).await.unwrap();
    assert!(!tasks[0].enabled);
    assert_eq!(tasks[0].runs[0].task_id.as_deref(), Some(id.as_str()));
    assert!(
        runtime
            .set_enabled(root.path(), &task.id, true)
            .await
            .is_err()
    );
    assert!(
        runtime
            .claim_pending(root.path(), Some(&task.id), 10)
            .await
            .is_err()
    );
    let value = serde_json::to_value(read_scheduled_tasks(root.path()).await.unwrap()).unwrap();
    assert_eq!(value[0]["runs"][0]["status"], "failed");
}

#[tokio::test]
async fn scheduled_acp_inspect_should_read_status_without_rewriting_identity_or_result() {
    let (_, catalog, _, id) = fixture(true).await;
    let key = json!({"projectId":"p","taskId":id,"key":"scheduled:proof-run"});
    assert_eq!(
        catalog
            .call("acp.submission.inspect", key.clone())
            .await
            .unwrap(),
        json!({"status":"completed"})
    );
    let mut wrong = key;
    wrong["taskId"] = json!("other");
    assert_eq!(
        catalog.call("acp.submission.inspect", wrong).await.unwrap()["status"],
        "conflict"
    );
    let original = json!({"projectId":"p","taskId":id,"key":"scheduled:proof-run","fingerprint":"original-body"});
    assert_eq!(
        catalog.call("acp.submission.read", original).await.unwrap()["result"]["id"],
        "confirmed-turn"
    );
}

#[tokio::test]
async fn scheduled_acp_prepare_should_preserve_unsent_identity_and_never_release_unknown() {
    let (_, catalog, _, _) = fixture(true).await;
    let request = json!({"projectId":"p","taskId":"planned-task","key":"scheduled:fresh","fingerprint":"original"});
    assert_eq!(
        catalog
            .call("acp.submission.prepare", request.clone())
            .await
            .unwrap()["status"],
        "available"
    );
    assert_eq!(
        catalog
            .call("acp.submission.begin", request.clone())
            .await
            .unwrap()["status"],
        "reserved"
    );
    assert_eq!(
        catalog
            .call("acp.submission.prepare", request.clone())
            .await
            .unwrap()["status"],
        "unknown"
    );
    let mut changed = request.clone();
    changed["fingerprint"] = json!("changed");
    assert_eq!(
        catalog
            .call("acp.submission.prepare", changed)
            .await
            .unwrap()["status"],
        "conflict"
    );
    catalog
        .call("acp.submission.retry", request.clone())
        .await
        .unwrap();
    assert_eq!(
        catalog
            .call("acp.submission.prepare", request)
            .await
            .unwrap()["status"],
        "available"
    );
}

#[tokio::test]
async fn scheduled_acp_launch_should_use_saved_native_options_and_replay_without_directory() {
    for engine in ["codex", "claude"] {
        let (root, catalog, mut scheduled, _) = fixture(true).await;
        scheduled.runs[0].id = format!("new-{engine}");
        let values = json!({"raw-model":"adapter-choice","permission":false});
        catalog.call("acp.schedule.set",json!({"source":"desktop","scheduleId":scheduled.id,"engine":engine,"values":values,"expectedRevision":0})).await.unwrap();
        let result = crate::application::scheduled_acp::try_start(
            root.path(),
            &catalog,
            &scheduled,
            |params| {
                let catalog = catalog.clone();
                let values = values.clone();
                async move {
                    assert_eq!(params["initialConfig"], values);
                    assert!(params.get("options").is_none());
                    let task = catalog
                        .call("task.read", json!({"id":params["taskId"]}))
                        .await?;
                    assert_eq!(task["provider"], engine);
                    let (mut request, _) =
                        crate::application::acp_prompt_submission::identity("p", &params)?;
                    assert_eq!(
                        catalog
                            .call("acp.submission.begin", request.clone())
                            .await?["status"],
                        "reserved"
                    );
                    request["result"] = json!({"id":"actual-turn","status":"running"});
                    catalog.call("acp.submission.complete", request).await?;
                    Ok(json!({"id":"actual-turn","status":"running"}))
                }
            },
        )
        .await
        .unwrap();
        let id = result.expect("ACP plan must use the configured executor");
        catalog
            .call(
                "acp.schedule.delete",
                json!({"source":"desktop","scheduleId":scheduled.id,"expectedRevision":1}),
            )
            .await
            .unwrap();
        catalog.call("project.put",json!({"id":"p","name":"Project","path":root.path().join("not-a-directory").to_string_lossy(),"createdAt":"2026-11-11"})).await.unwrap();
        let repeated = crate::application::scheduled_acp::try_start(
            root.path(),
            &catalog,
            &scheduled,
            |_| async { panic!("confirmed launch must not be submitted twice") },
        )
        .await
        .unwrap();
        assert_eq!(repeated.as_deref(), Some(id.as_str()));
    }
}

#[tokio::test]
async fn scheduled_acp_launch_failure_should_project_old_status_and_guard_unknown_only() {
    // 冻结 v0.53.0 的四种枚举，不能使用新增后的生产枚举冒充旧版读取器。
    #[derive(serde::Deserialize)]
    #[serde(rename_all = "snake_case")]
    enum ReleasedStatus {
        Failed,
        Running,
        Skipped,
        Started,
    }
    for unknown in [true, false] {
        let (root, catalog, mut scheduled, _) = fixture(true).await;
        scheduled.runs[0].id = "new-failure".into();
        catalog.call("acp.schedule.set",json!({"source":"desktop","scheduleId":scheduled.id,"engine":"claude","values":{"mode":false},"expectedRevision":0})).await.unwrap();
        let failure = crate::application::scheduled_acp::try_start(
            root.path(),
            &catalog,
            &scheduled,
            |params| {
                let catalog = catalog.clone();
                async move {
                    let (request, _) =
                        crate::application::acp_prompt_submission::identity("p", &params)?;
                    catalog
                        .call("acp.submission.begin", request.clone())
                        .await?;
                    if !unknown {
                        catalog.call("acp.submission.retry", request).await?;
                    }
                    Err(AppError::Acp("transport failure".into()))
                }
            },
        )
        .await
        .unwrap_err();
        assert_eq!(failure.unknown, unknown);
        let id = failure.task_id.clone().unwrap();
        let claim = ScheduledTaskClaim {
            run_id: "new-failure".into(),
            task: scheduled.clone(),
        };
        let mut tasks = vec![scheduled];
        finish_claim(
            &mut tasks,
            &mut HashSet::new(),
            &claim,
            10,
            Err(failure.message.clone()),
        );
        crate::application::scheduled_acp::project_failure(&mut tasks[0], &claim.run_id, &failure);
        write_scheduled_tasks(root.path(), &tasks).await.unwrap();
        drop(catalog);
        let runtime = ScheduledTaskRuntime::default();
        let saved = runtime.list(root.path()).await.unwrap();
        assert_eq!(saved[0].runs[0].task_id.as_deref(), Some(id.as_str()));
        assert!(
            serde_json::from_value::<ReleasedStatus>(
                serde_json::to_value(&saved[0].runs[0].status).unwrap()
            )
            .is_ok()
        );
        assert_eq!(
            runtime
                .set_enabled(root.path(), &claim.task.id, true)
                .await
                .is_err(),
            unknown
        );
        assert_eq!(
            runtime
                .claim_pending(root.path(), Some(&claim.task.id), 11)
                .await
                .is_err(),
            unknown
        );
    }
}

#[tokio::test]
async fn scheduled_acp_missing_native_config_should_not_use_web_config_or_call_port() {
    let (root, catalog, mut scheduled, _) = fixture(true).await;
    scheduled.runs[0].id = "no-native-config".into();
    catalog.call("acp.schedule.set",json!({"source":"web","scheduleId":scheduled.id,"engine":"claude","values":{},"expectedRevision":0})).await.unwrap();
    let result = crate::application::scheduled_acp::try_start(
        root.path(),
        &catalog,
        &scheduled,
        |_| async { panic!("web config must not activate native ACP") },
    )
    .await
    .unwrap();
    assert!(result.is_none());
}

#[tokio::test]
async fn scheduled_acp_corrupt_result_should_fail_without_rewriting_old_file() {
    let (root, _, _, _) = fixture(true).await;
    let path = root.path().join("scheduled-tasks/v1.json");
    let before = std::fs::read(&path).unwrap();
    let db = rusqlite::Connection::open(root.path().join("state.sqlite3")).unwrap();
    db.execute(
        "UPDATE native_acp_submissions SET result_json=?",
        ["{broken"],
    )
    .unwrap();
    assert!(
        ScheduledTaskRuntime::default()
            .list(root.path())
            .await
            .is_err()
    );
    assert_eq!(std::fs::read(path).unwrap(), before);
}
