use super::error::AppError;
use crate::infrastructure::local_catalog::LocalCatalog;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{future::Future, path::Path};

fn identity(project: &str, id: &str, run: &str) -> Result<(String, String), AppError> {
    let bytes = serde_json::to_vec(&(id, run)).map_err(|_| AppError::ScheduledTaskInvalid)?;
    let key = format!(
        "acp-plan:desktop:{}",
        crate::encoding::encode_lower_hex(Sha256::digest(bytes))
    );
    let task = super::acp_task_creation::creation_id(project, &key);
    Ok((key, task))
}
async fn finish(
    catalog: &LocalCatalog,
    id: &str,
    run: &str,
    status: &str,
    task: Value,
    error: Value,
) -> Result<Value, AppError> {
    let updated=catalog.call("acp.plan.finish",json!({"source":"desktop","scheduleId":id,"runId":run,"expectedStatus":"unknown","status":status,"taskId":task,"error":error})).await?;
    if updated.is_null() {
        return Ok(catalog
            .call(
                "acp.plan.readRun",
                json!({"source":"desktop","scheduleId":id,"runId":run}),
            )
            .await?);
    }
    Ok(updated)
}

/// 调用式执行不创建后台循环；已占用的运行只核对账本，不根据缺失记录重新投递。
pub(super) async fn execute_with<F, Fut>(
    directory: &Path,
    catalog: &LocalCatalog,
    id: &str,
    run_id: &str,
    submit: F,
) -> Result<Value, AppError>
where
    F: FnOnce(String, Value) -> Fut,
    Fut: Future<Output = Result<Value, AppError>>,
{
    let lookup = json!({"source":"desktop","scheduleId":id,"runId":run_id});
    let mut run = catalog.call("acp.plan.readRun", lookup.clone()).await?;
    if run.is_null() || matches!(run["status"].as_str(), Some("started" | "failed")) {
        return Ok(run);
    }
    let owned = if run["status"] == "claimed" {
        let claimed=catalog.call("acp.plan.finish",json!({"source":"desktop","scheduleId":id,"runId":run_id,"expectedStatus":"claimed","status":"unknown","taskId":run["taskId"],"error":"ACP execution outcome is pending"})).await?;
        if claimed.is_null() {
            run = catalog.call("acp.plan.readRun", lookup).await?;
            false
        } else {
            run = claimed;
            true
        }
    } else {
        false
    };
    if run["status"] != "unknown" {
        return Ok(run);
    }
    let definition = &run["definition"];
    let project = definition["projectId"]
        .as_str()
        .ok_or(AppError::ScheduledTaskInvalid)?;
    let (key, task) = identity(project, id, run_id)?;
    let params = json!({"taskId":task,"idempotencyKey":key,"input":definition["prompt"],"initialConfig":definition["values"]});
    let (request, _) = super::acp_prompt_submission::identity(project, &params)?;
    let phase = match catalog.call("acp.submission.read", request.clone()).await {
        Ok(value) => value,
        Err(_) => return Ok(run),
    };
    if phase["status"] == "completed" {
        if phase["result"]["id"].as_str().is_none_or(str::is_empty) {
            return Ok(run);
        }
        return finish(catalog, id, run_id, "started", json!(task), Value::Null).await;
    }
    if !owned || phase["status"] != "available" {
        // 只补回已有任务引用，不能把未知结果转换成一次新的发送。
        if run["taskId"].is_null()
            && (phase["status"] == "unknown"
                || (phase["status"] == "available"
                    && !catalog
                        .call("task.read", json!({"id":task}))
                        .await?
                        .is_null()))
        {
            return finish(
                catalog,
                id,
                run_id,
                "unknown",
                json!(task),
                run["error"].clone(),
            )
            .await;
        }
        return Ok(run);
    }
    // 稳定任务存在却没有完成证据时不重发，包括账本已过保留期的恢复。
    if !catalog
        .call("task.read", json!({"id":task}))
        .await?
        .is_null()
    {
        return finish(
            catalog,
            id,
            run_id,
            "unknown",
            json!(task),
            run["error"].clone(),
        )
        .await;
    }
    let mut sent = false;
    let mut created = false;
    let result: Result<(), AppError> = async {
        let prompt = &definition["prompt"];
        if prompt["attachments"]
            .as_array()
            .is_none_or(|a| !a.is_empty())
            || prompt["skills"].as_array().is_none_or(|a| !a.is_empty())
            || prompt["text"].as_str().is_none_or(|s| s.trim().is_empty())
        {
            return Err(AppError::ScheduledTaskInvalid);
        }
        let prepared = catalog
            .call("acp.submission.prepare", request.clone())
            .await?;
        if prepared["status"] != "available" {
            return Err(AppError::AcpSubmissionUnknown);
        }
        let engine = definition["engine"]
            .as_str()
            .ok_or(AppError::ScheduledTaskInvalid)?;
        super::acp_task_creation::create(directory, catalog, project, engine, &key).await?;
        created = true;
        let preview: String = prompt["text"]
            .as_str()
            .unwrap_or_default()
            .chars()
            .take(1024)
            .collect();
        catalog
            .call("task.preview", json!({"id":task,"preview":preview}))
            .await?;
        sent = true;
        submit(project.to_owned(), params).await?;
        Ok(())
    }
    .await;
    match result {
        Ok(()) => finish(catalog, id, run_id, "started", json!(task), Value::Null).await,
        Err(error) => {
            let phase = catalog.call("acp.submission.read", request).await;
            let known = phase.as_ref().is_ok_and(|p| {
                p["status"] == "completed"
                    && p["result"]["id"].as_str().is_some_and(|s| !s.is_empty())
            });
            if known {
                return finish(catalog, id, run_id, "started", json!(task), Value::Null).await;
            }
            let uncertain = matches!(
                error,
                AppError::AcpSubmissionUnknown | AppError::AcpSubmissionConflict
            ) || !phase.as_ref().is_ok_and(|p| p["status"] == "available");
            let uncertain = uncertain
                || (sent
                    && !catalog
                        .call(
                            "acp.submission.inspect",
                            json!({"projectId":project,"taskId":task,"key":key}),
                        )
                        .await
                        .is_ok_and(|p| p["status"] == "available"));
            let message: String = error.to_string().chars().take(1024).collect();
            finish(
                catalog,
                id,
                run_id,
                if uncertain { "unknown" } else { "failed" },
                if created { json!(task) } else { Value::Null },
                json!(message),
            )
            .await
        }
    }
}

#[cfg(not(test))]
pub(super) async fn execute(app: tauri::AppHandle, id: &str, run: &str) -> Result<Value, AppError> {
    let directory = crate::infrastructure::app_data::directory(&app)
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    let catalog = LocalCatalog::at(&directory)?;
    execute_with(
        &directory,
        &catalog,
        id,
        run,
        move |project, params| async move {
            super::acp_task_commands::acp_task_request(
                app,
                project,
                "prompt.start".into(),
                params,
                None,
            )
            .await
        },
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };
    async fn setup() -> (tempfile::TempDir, LocalCatalog) {
        setup_for("claude", false).await
    }
    async fn setup_for(engine: &str, attachments: bool) -> (tempfile::TempDir, LocalCatalog) {
        let root = tempfile::tempdir().unwrap();
        let store = LocalCatalog::at(root.path()).unwrap();
        let mut definition: Value = serde_json::from_str(include_str!(
            "../../../../tests/fixtures/acp-scheduled-plan-definition.json"
        ))
        .unwrap();
        definition["projectId"] = json!("temporary");
        definition["engine"] = json!(engine);
        if attachments {
            definition["prompt"]["attachments"] = json!([{ "id":"persistent-reference" }]);
        }
        definition["enabled"] = json!(true);
        store.call("acp.plan.set",json!({"source":"desktop","scheduleId":"plan","definition":definition,"expectedRevision":0})).await.unwrap();
        store.call("acp.plan.arm",json!({"source":"desktop","scheduleId":"plan","expectedRevision":1,"expectedStateRevision":0,"nextRunAt":10})).await.unwrap();
        store.call("acp.plan.claim",json!({"source":"desktop","scheduleId":"plan","expectedRevision":1,"expectedStateRevision":1,"now":10,"nextRunAt":null,"runId":"run"})).await.unwrap();
        (root, store)
    }
    #[tokio::test]
    async fn acp_plan_executor_should_submit_raw_config_once_and_replay_without_rpc() {
        let (root, store) = setup().await;
        let calls = Arc::new(AtomicUsize::new(0));
        let count = calls.clone();
        let result = execute_with(
            root.path(),
            &store,
            "plan",
            "run",
            move |project, params| async move {
                count.fetch_add(1, Ordering::SeqCst);
                assert_eq!(project, "temporary");
                assert_eq!(params["initialConfig"], json!({"mode":false}));
                assert_eq!(params["input"]["text"], "review");
                Ok(json!({"id":"turn","status":"running"}))
            },
        )
        .await
        .unwrap();
        assert_eq!(result["status"], "started");
        execute_with(root.path(), &store, "plan", "run", |_, _| async {
            panic!("must not resend")
        })
        .await
        .unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }
    #[tokio::test]
    async fn acp_plan_executor_should_keep_unknown_without_resending_after_restart() {
        let (root, store) = setup().await;
        execute_with(root.path(), &store, "plan", "run", |_, _| async {
            Err(AppError::AcpSubmissionUnknown)
        })
        .await
        .unwrap();
        let fresh = LocalCatalog::at(root.path()).unwrap();
        let result = execute_with(root.path(), &fresh, "plan", "run", |_, _| async {
            panic!("unknown must not send")
        })
        .await
        .unwrap();
        assert_eq!(result["status"], "unknown");
    }
    #[tokio::test]
    async fn acp_plan_executor_should_keep_known_result_after_run_write_failure() {
        let (root, store) = setup().await;
        let ledger = store.clone();
        let db = rusqlite::Connection::open(root.path().join("state.sqlite3")).unwrap();
        db.execute_batch("CREATE TRIGGER fail_plan_result BEFORE UPDATE ON acp_plan_runs WHEN NEW.status='started' BEGIN SELECT RAISE(ABORT,'run failed'); END;").unwrap();
        let result = execute_with(
            root.path(),
            &store,
            "plan",
            "run",
            move |project, params| async move {
                let (mut request, _) =
                    super::super::acp_prompt_submission::identity(&project, &params)?;
                ledger.call("acp.submission.begin", request.clone()).await?;
                let response = json!({"id":"confirmed-turn","status":"running"});
                request["result"] = response.clone();
                ledger.call("acp.submission.complete", request).await?;
                Ok(response)
            },
        )
        .await;
        assert!(result.is_err());
        db.execute_batch("DROP TRIGGER fail_plan_result").unwrap();
        let restored = LocalCatalog::at(root.path()).unwrap();
        let value = execute_with(root.path(), &restored, "plan", "run", |_, _| async {
            panic!("known result must not resend")
        })
        .await
        .unwrap();
        assert_eq!(value["status"], "started");
        assert!(!value["taskId"].is_null());
    }
    #[tokio::test]
    async fn acp_plan_executor_should_reject_resources_before_creation_and_preserve_definite_failure()
     {
        let (root, store) = setup_for("codex", true).await;
        let value = execute_with(root.path(), &store, "plan", "run", |_, _| async {
            panic!("resources unavailable")
        })
        .await
        .unwrap();
        assert_eq!(value["status"], "failed");
        assert!(value["taskId"].is_null());
        let (_, id) = identity("temporary", "plan", "run").unwrap();
        assert!(
            store
                .call("task.read", json!({"id":id}))
                .await
                .unwrap()
                .is_null()
        );
        let (root, store) = setup_for("codex", false).await;
        let value = execute_with(root.path(), &store, "plan", "run", |_, _| async {
            Err(AppError::Acp("not submitted".into()))
        })
        .await
        .unwrap();
        assert_eq!(value["status"], "failed");
        assert!(!value["taskId"].is_null());
        assert_eq!(
            store
                .call("task.read", json!({"id":value["taskId"]}))
                .await
                .unwrap()["provider"],
            "codex"
        );
    }
    #[tokio::test]
    async fn acp_plan_executor_should_not_resend_when_unknown_ledger_is_missing() {
        let (root, store) = setup().await;
        execute_with(root.path(), &store, "plan", "run", |_, _| async {
            Err(AppError::AcpSubmissionUnknown)
        })
        .await
        .unwrap();
        let db = rusqlite::Connection::open(root.path().join("state.sqlite3")).unwrap();
        db.execute("DELETE FROM native_acp_submissions", [])
            .unwrap();
        db.execute(
            "UPDATE acp_plan_runs SET task_id=NULL WHERE status='unknown'",
            [],
        )
        .unwrap();
        let value = execute_with(root.path(), &store, "plan", "run", |_, _| async {
            panic!("missing ledger is not proof of no send")
        })
        .await
        .unwrap();
        assert_eq!(value["status"], "unknown");
        assert!(!value["taskId"].is_null());
    }
    #[tokio::test]
    async fn acp_plan_executor_should_have_one_sender_for_concurrent_execution() {
        let (root, store) = setup().await;
        let directory = root.path().to_owned();
        let sender = store.clone();
        let (entered, ready) = tokio::sync::oneshot::channel();
        let (release, wait) = tokio::sync::oneshot::channel();
        let first = tokio::spawn(async move {
            execute_with(&directory, &sender, "plan", "run", move |_, _| async move {
                let _ = entered.send(());
                let _ = wait.await;
                Ok(json!({"id":"turn","status":"running"}))
            })
            .await
        });
        ready.await.unwrap();
        let value = execute_with(root.path(), &store, "plan", "run", |_, _| async {
            panic!("second executor must not send")
        })
        .await
        .unwrap();
        assert_eq!(value["status"], "unknown");
        release.send(()).unwrap();
        assert_eq!(first.await.unwrap().unwrap()["status"], "started");
    }
}
