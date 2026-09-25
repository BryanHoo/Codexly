use super::*;
use serde_json::json;
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};

fn reference() -> PendingResolutionReference {
    PendingResolutionReference {
        project_id: "project".into(),
        task_id: "task".into(),
        turn_id: "turn".into(),
        item_id: "item".into(),
        request_id: "number:9".into(),
        created_at: "2026-09-13T00:00:00Z".into(),
    }
}

#[tokio::test]
async fn pending_resolution_should_replay_without_sending_a_second_answer() {
    let registry = TurnStartRegistry::default();
    let budget = SubmissionBudget::default();
    let calls = Arc::new(AtomicUsize::new(0));
    for _ in 0..2 {
        let calls = Arc::clone(&calls);
        let result = run(
            &registry,
            &budget,
            &reference(),
            &json!({"answers":{"q":["yes"]}}),
            "key",
            async move {
                calls.fetch_add(1, Ordering::SeqCst);
                Ok(json!({"request":{"status":"resolved"}}))
            },
        )
        .await
        .unwrap();
        assert_eq!(result["request"]["status"], "resolved");
    }
    assert_eq!(calls.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn pending_resolution_should_reject_changed_identity_and_answers() {
    let registry = TurnStartRegistry::default();
    let budget = SubmissionBudget::default();
    let resolution = json!({"answers":{"q":["yes"]}});
    run(
        &registry,
        &budget,
        &reference(),
        &resolution,
        "key",
        async { Ok(json!({})) },
    )
    .await
    .unwrap();
    for field in [
        "projectId",
        "taskId",
        "turnId",
        "itemId",
        "requestId",
        "createdAt",
    ] {
        let mut changed = serde_json::to_value(reference()).unwrap();
        changed[field] = json!("different");
        let changed = serde_json::from_value(changed).unwrap();
        let result = run(&registry, &budget, &changed, &resolution, "key", async {
            panic!("must not execute")
        })
        .await;
        assert_eq!(result.unwrap_err()["code"], "IDEMPOTENCY_CONFLICT");
    }
    let result = run(
        &registry,
        &budget,
        &reference(),
        &json!({"answers":{"q":["no"]}}),
        "key",
        async { panic!("must not execute") },
    )
    .await;
    assert_eq!(result.unwrap_err()["code"], "IDEMPOTENCY_CONFLICT");
}

#[tokio::test]
async fn pending_resolution_should_finish_after_waiter_cancellation_and_hold_budget() {
    let registry = Arc::new(TurnStartRegistry::default());
    let budget = Arc::new(SubmissionBudget::default());
    let (started, observed) = tokio::sync::oneshot::channel();
    let (release, released) = tokio::sync::oneshot::channel();
    let worker_registry = Arc::clone(&registry);
    let worker_budget = Arc::clone(&budget);
    let waiter = tokio::spawn(async move {
        run(
            &worker_registry,
            &worker_budget,
            &reference(),
            &json!({"decision":"allow"}),
            "key",
            async move {
                started.send(()).unwrap();
                released.await.unwrap();
                Ok(json!({"request":{"status":"resolved"}}))
            },
        )
        .await
    });
    observed.await.unwrap();
    waiter.abort();
    assert!(waiter.await.unwrap_err().is_cancelled());
    let permits: Vec<_> = (0..15).map(|_| budget.reserve(1).unwrap()).collect();
    assert!(budget.reserve(1).is_err());
    drop(permits);
    release.send(()).unwrap();
    let replay = run(
        &registry,
        &budget,
        &reference(),
        &json!({"decision":"allow"}),
        "key",
        async { panic!("must replay") },
    )
    .await
    .unwrap();
    assert_eq!(replay["request"]["status"], "resolved");
    assert!(budget.reserve(8 * 1024 * 1024).is_ok());
}

#[tokio::test]
async fn pending_resolution_should_retry_only_before_runtime_acquisition() {
    let registry = TurnStartRegistry::default();
    let budget = SubmissionBudget::default();
    let resolution = json!({"decision":"allow"});
    assert!(
        run(
            &registry,
            &budget,
            &reference(),
            &resolution,
            "key",
            async { Err(AppError::CodexRuntimeUnavailable) }
        )
        .await
        .is_err()
    );
    assert!(
        run(
            &registry,
            &budget,
            &reference(),
            &resolution,
            "key",
            async { Ok(json!({})) }
        )
        .await
        .is_ok()
    );
    let failed = run(
        &registry,
        &budget,
        &reference(),
        &resolution,
        "rpc",
        async {
            Err(AppError::CodexRpc {
                rpc_code: -32000,
                message: "Codex runtime is unavailable".into(),
            })
        },
    )
    .await
    .unwrap_err();
    assert_eq!(
        run(
            &registry,
            &budget,
            &reference(),
            &resolution,
            "rpc",
            async { panic!("must not retry a wire failure") }
        )
        .await
        .unwrap_err(),
        failed
    );
}

#[tokio::test]
async fn pending_resolution_should_validate_before_side_effects_and_bound_admission() {
    let registry = TurnStartRegistry::default();
    let budget = SubmissionBudget::default();
    let full = budget.reserve(8 * 1024 * 1024).unwrap();
    let result = run(&registry, &budget, &reference(), &json!({}), "key", async {
        panic!("budget exhausted")
    })
    .await;
    assert_eq!(result.unwrap_err()["code"], "IDEMPOTENCY_CAPACITY_EXCEEDED");
    drop(full);
    let mut invalid = reference();
    invalid.request_id.clear();
    for (reference, answer, key) in [
        (invalid, json!({}), "key"),
        (reference(), json!({}), " "),
        (
            reference(),
            json!({"answers":"x".repeat(4 * 1024 * 1024)}),
            "key",
        ),
    ] {
        assert_eq!(
            run(&registry, &budget, &reference, &answer, key, async {
                panic!("invalid request")
            })
            .await
            .unwrap_err()["code"],
            "INVALID_REQUEST"
        );
    }
    assert!(
        run(&registry, &budget, &reference(), &json!({}), "key", async {
            Ok(json!({}))
        })
        .await
        .is_ok()
    );
}

#[tokio::test]
async fn pending_resolution_should_write_one_json_rpc_answer() {
    use tokio::io::{AsyncBufReadExt, BufReader};
    let (client, server) = tokio::io::duplex(4096);
    let (reader, writer) = tokio::io::split(client);
    let connection = Arc::new(codex::AppServerConnection::new(reader, writer));
    let server = tokio::spawn(async move {
        let mut lines = BufReader::new(server).lines();
        let line = lines.next_line().await.unwrap().unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(&line).unwrap(),
            json!({"id":9,"result":{"decision":"accept"}})
        );
        assert!(lines.next_line().await.unwrap().is_none());
    });
    let registry = TurnStartRegistry::default();
    let budget = SubmissionBudget::default();
    for _ in 0..2 {
        let connection = Arc::clone(&connection);
        run(
            &registry,
            &budget,
            &reference(),
            &json!({"decision":"allow"}),
            "key",
            async move {
                connection
                    .respond(9, &json!({"decision":"accept"}))
                    .await
                    .map_err(AppError::from)?;
                Ok(json!({"request":{"status":"resolved"}}))
            },
        )
        .await
        .unwrap();
    }
    drop(connection);
    server.await.unwrap();
}

#[test]
fn pending_resolution_should_match_all_native_identity_fields() {
    let reference = reference();
    let mut pending = serde_json::to_value(&reference).unwrap();
    pending["status"] = json!("pending");
    assert!(reference.matches(&pending));
    for field in [
        "projectId",
        "taskId",
        "turnId",
        "itemId",
        "requestId",
        "createdAt",
        "status",
    ] {
        let mut changed = pending.clone();
        changed[field] = json!("changed");
        assert!(!reference.matches(&changed));
    }
}
