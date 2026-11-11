use super::*;

#[tokio::test]
async fn acp_plan_executor_should_recover_cleanup_without_sending_or_reading_submission() {
    for status in ["started", "failed"] {
        let (root, store, _definition, _resource) = attached().await;
        let (_, task) = identity("temporary", "plan", "run").unwrap();
        let parent = root
            .path()
            .join("attachments")
            .join(crate::infrastructure::queued_media::scope(&task));
        let held = root.path().join("held-cache");
        let blocked = parent.clone();
        let backup = held.clone();
        let result = execute_with(
            root.path(),
            &store,
            "plan",
            "run",
            move |_, _, input| async move {
                let input = input.unwrap();
                assert_eq!(
                    tokio::fs::read(input["attachments"][0]["id"].as_str().unwrap())
                        .await
                        .unwrap(),
                    b"proof"
                );
                // 用普通文件阻断清理目录，跨平台模拟缓存清理失败，实际字节暂存在旁边。
                tokio::fs::rename(&blocked, &backup).await.unwrap();
                tokio::fs::write(&blocked, b"blocked").await.unwrap();
                if status == "started" {
                    Ok(json!({"id":"turn","status":"running"}))
                } else {
                    Err(AppError::Acp("ACP_HOST_PROMPT_NOT_SUBMITTED".into()))
                }
            },
        )
        .await
        .unwrap();
        assert_eq!(result["status"], "unknown");
        assert_eq!(
            store
                .call(
                    "acp.plan.completion.read",
                    json!({"source":"desktop","scheduleId":"plan","runId":"run"})
                )
                .await
                .unwrap()["status"],
            status
        );
        tokio::fs::remove_file(&parent).await.unwrap();
        tokio::fs::rename(&held, &parent).await.unwrap();
        let db = rusqlite::Connection::open(root.path().join("state.sqlite3")).unwrap();
        db.execute("DELETE FROM native_acp_submissions", [])
            .unwrap();
        drop(db);
        drop(store);
        let fresh = LocalCatalog::at(root.path()).unwrap();
        let result = execute_with(root.path(), &fresh, "plan", "run", |_, _, _| async {
            panic!("known intent must not resend")
        })
        .await
        .unwrap();
        assert_eq!(result["status"], status);
        assert!(
            tokio::fs::read_dir(parent)
                .await
                .unwrap()
                .next_entry()
                .await
                .unwrap()
                .is_none()
        );
        assert!(
            fresh
                .call(
                    "acp.plan.completion.read",
                    json!({"source":"desktop","scheduleId":"plan","runId":"run"})
                )
                .await
                .unwrap()
                .is_null()
        );
    }
}

#[tokio::test]
async fn acp_plan_executor_should_keep_unknown_resource_copy_and_never_resend() {
    let (root, store, _definition, _resource) = attached().await;
    let writer = store.clone();
    let result = execute_with(
        root.path(),
        &store,
        "plan",
        "run",
        move |project, params, input| async move {
            assert!(input.is_some());
            let (request, _) =
                super::super::acp_prompt_submission::identity(&project, &params).unwrap();
            writer.call("acp.submission.begin", request).await.unwrap();
            Err(AppError::AcpSubmissionUnknown)
        },
    )
    .await
    .unwrap();
    assert_eq!(result["status"], "unknown");
    let (_, task) = identity("temporary", "plan", "run").unwrap();
    let parent = root
        .path()
        .join("attachments")
        .join(crate::infrastructure::queued_media::scope(&task));
    assert!(
        tokio::fs::read_dir(&parent)
            .await
            .unwrap()
            .next_entry()
            .await
            .unwrap()
            .is_some()
    );
    drop(store);
    let fresh = LocalCatalog::at(root.path()).unwrap();
    assert_eq!(
        execute_with(root.path(), &fresh, "plan", "run", |_, _, _| async {
            panic!("unknown must not resend")
        })
        .await
        .unwrap()["status"],
        "unknown"
    );
    assert!(
        tokio::fs::read_dir(parent)
            .await
            .unwrap()
            .next_entry()
            .await
            .unwrap()
            .is_some()
    );
}

#[tokio::test]
async fn acp_plan_executor_should_reject_corrupt_resource_before_creating_task() {
    let (root, store, _definition, resource) = attached().await;
    let db = rusqlite::Connection::open(root.path().join("state.sqlite3")).unwrap();
    db.execute(
        "UPDATE acp_plan_resources SET digest=? WHERE token=?",
        rusqlite::params!["0".repeat(64), resource["token"].as_str()],
    )
    .unwrap();
    let result = execute_with(root.path(), &store, "plan", "run", |_, _, _| async {
        panic!("corrupt resource must not send")
    })
    .await
    .unwrap();
    assert_eq!(result["status"], "failed");
    let (_, task) = identity("temporary", "plan", "run").unwrap();
    assert!(
        store
            .call("task.read", json!({"id":task}))
            .await
            .unwrap()
            .is_null()
    );
}

async fn attached() -> (tempfile::TempDir, LocalCatalog, Value, Value) {
    let root = tempfile::tempdir().unwrap();
    let store = LocalCatalog::at(root.path()).unwrap();
    let uploaded = crate::infrastructure::workspace::store_attachment(
        root.path(),
        "temporary",
        "text",
        "proof.txt",
        b"proof",
    )
    .await
    .unwrap();
    let attachment = serde_json::to_value(uploaded).unwrap()["attachment"].clone();
    let resource = super::super::acp_plan_resources::stage(
        root.path(),
        &store,
        "plan",
        "temporary",
        &attachment,
        &tokio_util::sync::CancellationToken::new(),
    )
    .await
    .unwrap();
    let mut definition: Value = serde_json::from_str(include_str!(
        "../../../../tests/fixtures/acp-scheduled-plan-definition.json"
    ))
    .unwrap();
    definition["projectId"] = json!("temporary");
    definition["enabled"] = json!(true);
    definition["prompt"]["text"] = json!("");
    definition["prompt"]["attachments"] = json!([{"id":resource["attachment"]["id"]}]);
    store.call("acp.plan.save",json!({"source":"desktop","scheduleId":"plan","definition":definition.clone(),"expectedRevision":0,"resources":[resource["token"]]})).await.unwrap();
    store.call("acp.plan.arm",json!({"source":"desktop","scheduleId":"plan","expectedRevision":1,"expectedStateRevision":0,"nextRunAt":10})).await.unwrap();
    store.call("acp.plan.claim",json!({"source":"desktop","scheduleId":"plan","runId":"run","expectedRevision":1,"expectedStateRevision":1,"now":10,"nextRunAt":null})).await.unwrap();
    (root, store, definition, resource)
}

#[tokio::test]
async fn acp_plan_executor_should_send_attachments_with_original_identity_once() {
    let (root, store, definition, _resource) = attached().await;
    let result = execute_with(
        root.path(),
        &store,
        "plan",
        "run",
        move |project, params, input| async move {
            assert_eq!(project, "temporary");
            assert_eq!(params["input"], definition["prompt"]);
            let restored = input.unwrap();
            let path = restored["attachments"][0]["id"].as_str().unwrap();
            assert_eq!(tokio::fs::read(path).await.unwrap(), b"proof");
            assert_ne!(
                restored["attachments"][0]["id"],
                params["input"]["attachments"][0]["id"]
            );
            Ok(json!({"id":"turn","status":"running"}))
        },
    )
    .await
    .unwrap();
    assert_eq!(result["status"], "started");
    execute_with(root.path(), &store, "plan", "run", |_, _, _| async {
        panic!("must not resend")
    })
    .await
    .unwrap();
}
