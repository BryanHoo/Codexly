use super::*;
use crate::domain::sidebar::AgentTask;
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};

fn response() -> AgentTaskMutationResponse {
    AgentTaskMutationResponse {
        task: AgentTask {
            id: "task".into(),
            project_id: "project".into(),
            title: "Task".into(),
            updated_at: "2026-09-13T00:00:00Z".into(),
            pinned: false,
        },
    }
}

#[tokio::test]
async fn task_creation_should_retry_after_runtime_becomes_available() {
    let registry = TaskCreationRegistry::default();
    let error = registry
        .run("project", "key", async {
            Err(AppError::CodexRuntimeUnavailable)
        })
        .await
        .unwrap_err();
    assert_eq!(error, json!("Codex runtime is unavailable"));
    let result = registry
        .run("project", "key", async { Ok(response()) })
        .await;
    assert_eq!(result.unwrap(), response());
}

#[tokio::test]
async fn task_creation_retry_should_preserve_scope_capacity_and_original_retention() {
    let registry = TaskCreationRegistry::default();
    for index in 0..CAPACITY {
        registry
            .run("project", &index.to_string(), async {
                Err(AppError::CodexRuntimeUnavailable)
            })
            .await
            .unwrap_err();
    }
    let registered = registry.entries.lock().unwrap()["0"].started;
    let error = registry
        .run("other-project", "0", async {
            panic!("retry must not change project")
        })
        .await
        .unwrap_err();
    assert_eq!(error["code"], "IDEMPOTENCY_CONFLICT");
    let error = registry
        .run("project", "extra", async {
            panic!("new keys must respect capacity")
        })
        .await
        .unwrap_err();
    assert_eq!(error["code"], "IDEMPOTENCY_CAPACITY_EXCEEDED");
    assert_eq!(
        registry
            .run("project", "0", async { Ok(response()) })
            .await
            .unwrap(),
        response()
    );
    let entries = registry.entries.lock().unwrap();
    assert_eq!(entries.len(), CAPACITY);
    assert_eq!(entries["0"].started, registered);
}

#[tokio::test]
async fn task_creation_retry_should_not_trust_rpc_error_text() {
    let registry = TaskCreationRegistry::default();
    let error = registry
        .run("project", "key", async {
            Err(AppError::CodexRpc {
                rpc_code: -32603,
                message: "Codex runtime is unavailable".into(),
            })
        })
        .await
        .unwrap_err();
    assert_eq!(
        registry
            .run("project", "key", async {
                panic!("RPC error must not permit recreation")
            })
            .await
            .unwrap_err(),
        error
    );
}

#[tokio::test]
async fn task_creation_retry_should_merge_concurrent_retries_and_preserve_old_waiters() {
    let registry = TaskCreationRegistry::default();
    let error = registry
        .run("project", "key", async {
            Err(AppError::CodexRuntimeUnavailable)
        })
        .await
        .unwrap_err();
    let old = registry.entries.lock().unwrap()["key"].result.clone();
    let release = Arc::new(tokio::sync::Notify::new());
    let mut first = Box::pin(registry.run("project", "key", {
        let release = Arc::clone(&release);
        async move {
            release.notified().await;
            Ok(response())
        }
    }));
    let mut second = Box::pin(registry.run("project", "key", async {
        panic!("concurrent retry must share execution")
    }));
    std::future::poll_fn(|context| {
        assert!(first.as_mut().poll(context).is_pending());
        assert!(second.as_mut().poll(context).is_pending());
        std::task::Poll::Ready(())
    })
    .await;
    release.notify_one();
    let (first, second) = tokio::join!(first, second);
    assert_eq!(first.unwrap(), response());
    assert_eq!(second.unwrap(), response());
    assert_eq!(old.borrow().as_ref().unwrap().as_ref().unwrap_err(), &error);
    assert_eq!(
        registry
            .run("project", "key", async {
                panic!("successful retry must replay")
            })
            .await
            .unwrap(),
        response()
    );
}

#[tokio::test]
async fn task_creation_should_continue_after_caller_cancellation_and_share_inflight_work() {
    let registry = Arc::new(TaskCreationRegistry::default());
    let calls = Arc::new(AtomicUsize::new(0));
    let entered = Arc::new(tokio::sync::Notify::new());
    let release = Arc::new(tokio::sync::Notify::new());
    let first = {
        let (registry, calls, entered, release) = (
            Arc::clone(&registry),
            Arc::clone(&calls),
            Arc::clone(&entered),
            Arc::clone(&release),
        );
        tokio::spawn(async move {
            registry
                .run("project", "key", async move {
                    calls.fetch_add(1, Ordering::SeqCst);
                    entered.notify_one();
                    release.notified().await;
                    Ok(response())
                })
                .await
        })
    };
    entered.notified().await;
    first.abort();
    assert!(first.await.unwrap_err().is_cancelled());
    let second = {
        let (registry, calls) = (Arc::clone(&registry), Arc::clone(&calls));
        tokio::spawn(async move {
            registry
                .run("project", "key", async move {
                    calls.fetch_add(1, Ordering::SeqCst);
                    Ok(response())
                })
                .await
        })
    };
    tokio::task::yield_now().await;
    assert!(!second.is_finished());
    release.notify_one();
    assert_eq!(second.await.unwrap().unwrap(), response());
    assert_eq!(calls.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn task_creation_should_replay_failure_without_repeating_unknown_side_effects() {
    let registry = TaskCreationRegistry::default();
    let calls = Arc::new(AtomicUsize::new(0));
    for _ in 0..2 {
        let calls = Arc::clone(&calls);
        let result = registry
            .run("project", "key", async move {
                calls.fetch_add(1, Ordering::SeqCst);
                Err(AppError::CodexRpc {
                    rpc_code: -32602,
                    message: "creation failed".into(),
                })
            })
            .await;
        assert_eq!(
            result.unwrap_err(),
            json!({"code":"CODEX_RPC_ERROR","rpcCode":-32602,"message":"creation failed"})
        );
    }
    assert_eq!(calls.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn task_creation_should_reject_cross_project_key_reuse() {
    let registry = TaskCreationRegistry::default();
    registry
        .run("project", "key", async { Ok(response()) })
        .await
        .unwrap();
    let result = registry
        .run("other-project", "key", async {
            panic!("conflicting work must not execute")
        })
        .await;
    assert_eq!(result.unwrap_err()["code"], "IDEMPOTENCY_CONFLICT");
}

#[tokio::test]
async fn task_creation_should_validate_identity_before_running_work() {
    for (project, key) in [
        ("project", ""),
        ("project", " "),
        ("", "key"),
        ("project", &"x".repeat(129)),
        (&"x".repeat(1025), "key"),
    ] {
        let registry = TaskCreationRegistry::default();
        let result = registry
            .run(project, key, async {
                panic!("invalid work must not execute")
            })
            .await;
        assert_eq!(result.unwrap_err()["code"], "INVALID_REQUEST");
    }
}

#[tokio::test]
async fn task_creation_should_preserve_live_records_at_capacity_and_reclaim_only_expired_entries() {
    let registry = TaskCreationRegistry::default();
    for index in 0..CAPACITY {
        registry
            .run("project", &index.to_string(), async { Ok(response()) })
            .await
            .unwrap();
    }
    let result = registry
        .run("project", "overflow", async {
            panic!("overflow must not execute")
        })
        .await;
    assert_eq!(result.unwrap_err()["code"], "IDEMPOTENCY_CAPACITY_EXCEEDED");
    assert_eq!(
        registry
            .run("project", "0", async {
                panic!("retained result must replay")
            })
            .await
            .unwrap(),
        response()
    );
    registry
        .entries
        .lock()
        .unwrap()
        .get_mut("0")
        .unwrap()
        .started = Instant::now() - RETENTION;
    registry
        .run("project", "overflow", async { Ok(response()) })
        .await
        .unwrap();
    assert_eq!(registry.entries.lock().unwrap().len(), CAPACITY);
}

#[tokio::test]
async fn task_creation_should_retain_a_tombstone_for_oversized_results() {
    let registry = TaskCreationRegistry::default();
    let mut large = response();
    large.task.title = "x".repeat(MAX_RESULT_BYTES + 1);
    let result = registry
        .run("project", "key", async move { Ok(large) })
        .await;
    assert_eq!(result.unwrap_err()["code"], "TASK_CREATION_UNCERTAIN");
    let replay = registry
        .run("project", "key", async {
            panic!("oversized result must not permit recreation")
        })
        .await;
    assert_eq!(replay.unwrap_err()["code"], "TASK_CREATION_UNCERTAIN");
}

#[tokio::test]
async fn task_creation_should_not_restart_a_panicked_worker() {
    let registry = TaskCreationRegistry::default();
    let result = registry
        .run("project", "key", async {
            panic!("simulated creation worker failure")
        })
        .await;
    assert_eq!(result.unwrap_err()["code"], "TASK_CREATION_UNCERTAIN");
    let replay = registry
        .run("project", "key", async { Ok(response()) })
        .await;
    assert_eq!(replay.unwrap_err()["code"], "TASK_CREATION_UNCERTAIN");
}

#[tokio::test]
async fn task_creation_should_replay_the_same_attempt_without_creating_again() {
    let registry = TaskCreationRegistry::default();
    let calls = Arc::new(AtomicUsize::new(0));
    for _ in 0..2 {
        let calls = Arc::clone(&calls);
        assert_eq!(
            registry
                .run("project", "key", async move {
                    calls.fetch_add(1, Ordering::SeqCst);
                    Ok(response())
                })
                .await
                .unwrap(),
            response()
        );
    }
    assert_eq!(calls.load(Ordering::SeqCst), 1);
}
