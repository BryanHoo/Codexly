use super::*;
use serde_json::json;
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};

fn request() -> QueueStartRequest {
    QueueStartRequest {
        project_id: "project".into(),
        task_id: "task".into(),
        queued_submission_id: None,
        idempotency_key: "key".into(),
    }
}

async fn run<F>(
    registry: &Arc<TurnStartRegistry>,
    budget: &SubmissionBudget,
    request: QueueStartRequest,
    execute: F,
) -> Result<Value, Value>
where
    F: Future<Output = Result<Value, AppError>> + Send + 'static,
{
    super::run(registry, budget, request, execute, |_| async { Ok(()) }).await
}

#[tokio::test]
async fn queue_start_should_not_consume_another_item_when_replaying_next_item_request() {
    let registry = Arc::new(TurnStartRegistry::default());
    let budget = SubmissionBudget::default();
    let consumed = Arc::new(AtomicUsize::new(0));
    for _ in 0..2 {
        let consumed = Arc::clone(&consumed);
        let response = run(&registry, &budget, request(), async move {
            let index = consumed.fetch_add(1, Ordering::SeqCst);
            Ok(json!({"turn":index}))
        })
        .await
        .unwrap();
        assert_eq!(response["turn"], 0);
    }
    assert_eq!(consumed.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn queue_start_should_reject_changed_project_task_or_selected_item() {
    let registry = Arc::new(TurnStartRegistry::default());
    let budget = SubmissionBudget::default();
    run(&registry, &budget, request(), async { Ok(json!({})) })
        .await
        .unwrap();
    for request in [
        QueueStartRequest {
            project_id: "other".into(),
            ..request()
        },
        QueueStartRequest {
            task_id: "other".into(),
            ..request()
        },
        QueueStartRequest {
            queued_submission_id: Some("queue-a".into()),
            ..request()
        },
    ] {
        let error = run(&registry, &budget, request, async {
            panic!("changed target must not execute")
        })
        .await
        .unwrap_err();
        assert_eq!(error["code"], "IDEMPOTENCY_CONFLICT");
    }
}

#[tokio::test]
async fn queue_start_should_validate_ids_and_keys_before_side_effects() {
    let registry = Arc::new(TurnStartRegistry::default());
    let budget = SubmissionBudget::default();
    for request in [
        QueueStartRequest {
            project_id: String::new(),
            ..request()
        },
        QueueStartRequest {
            task_id: "x".repeat(1025),
            ..request()
        },
        QueueStartRequest {
            queued_submission_id: Some(String::new()),
            ..request()
        },
        QueueStartRequest {
            queued_submission_id: Some("x".repeat(1025)),
            ..request()
        },
        QueueStartRequest {
            idempotency_key: " ".into(),
            ..request()
        },
        QueueStartRequest {
            idempotency_key: "x".repeat(129),
            ..request()
        },
    ] {
        assert_eq!(
            run(&registry, &budget, request, async {
                panic!("invalid request must not execute")
            })
            .await
            .unwrap_err()["code"],
            "INVALID_REQUEST"
        );
    }
}

#[tokio::test]
async fn queue_start_should_share_and_release_the_submission_budget() {
    let registry = Arc::new(TurnStartRegistry::default());
    let budget = SubmissionBudget::default();
    let occupied = budget.reserve(8 * 1024 * 1024).unwrap();
    assert_eq!(
        run(&registry, &budget, request(), async {
            panic!("budget rejection must precede start")
        })
        .await
        .unwrap_err()["code"],
        "IDEMPOTENCY_CAPACITY_EXCEEDED"
    );
    drop(occupied);
    run(&registry, &budget, request(), async { Ok(json!({})) })
        .await
        .unwrap();
    assert!(budget.reserve(8 * 1024 * 1024).is_ok());
}

#[tokio::test]
async fn queue_start_should_retry_runtime_unavailable_but_replay_provider_failure() {
    let registry = Arc::new(TurnStartRegistry::default());
    let budget = SubmissionBudget::default();
    assert!(
        run(&registry, &budget, request(), async {
            Err(AppError::CodexRuntimeUnavailable)
        })
        .await
        .is_err()
    );
    let expected = run(&registry, &budget, request(), async {
        Err(AppError::CodexRpc {
            rpc_code: -32000,
            message: "runtime unavailable".into(),
        })
    })
    .await
    .unwrap_err();
    let replay = run(&registry, &budget, request(), async {
        panic!("RPC failure must not allow another start")
    })
    .await
    .unwrap_err();
    assert_eq!(replay, expected);
}

#[tokio::test]
async fn queue_start_should_keep_worker_after_waiter_cancellation() {
    let registry = Arc::new(TurnStartRegistry::default());
    let budget = Arc::new(SubmissionBudget::default());
    let worker_registry = Arc::clone(&registry);
    let worker_budget = Arc::clone(&budget);
    let (entered_tx, entered_rx) = tokio::sync::oneshot::channel();
    let (finish_tx, finish_rx) = tokio::sync::oneshot::channel();
    let waiter = tokio::spawn(async move {
        run(&worker_registry, &worker_budget, request(), async move {
            entered_tx.send(()).unwrap();
            finish_rx.await.unwrap();
            Ok(json!({"turn":"original"}))
        })
        .await
    });
    entered_rx.await.unwrap();
    waiter.abort();
    let _ = waiter.await;
    finish_tx.send(()).unwrap();
    let replay = run(&registry, &budget, request(), async {
        panic!("cancelled waiter must not consume another item")
    })
    .await
    .unwrap();
    assert_eq!(replay["turn"], "original");
}

#[tokio::test]
async fn queue_start_should_send_one_native_start_and_replay_the_original_turn() {
    use crate::infrastructure::codex;
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, duplex, split};
    let (client, server) = duplex(8192);
    let (reader, writer) = split(client);
    let connection = Arc::new(codex::AppServerConnection::new(reader, writer));
    let (reader, mut writer) = split(server);
    let peer = tokio::spawn(async move {
        let mut lines = BufReader::new(reader).lines();
        let request: Value =
            serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
        assert_eq!(request["method"], "thread/queue/start");
        assert_eq!(request["params"]["threadId"], "task");
        assert_eq!(request["params"]["queuedSubmissionId"], "queue-a");
        let turn = json!({"id":"turn", "status":"inProgress", "startedAt":null,"completedAt":null,"error":null,"items":[]});
        writer
            .write_all(
                format!("{}\n", json!({"id":request["id"],"result":{"turn":turn}})).as_bytes(),
            )
            .await
            .unwrap();
        assert!(
            lines.next_line().await.unwrap().is_none(),
            "replay must not repeat queue/start"
        );
    });
    let registry = Arc::new(TurnStartRegistry::default());
    let budget = SubmissionBudget::default();
    for _ in 0..2 {
        let connection = Arc::clone(&connection);
        let response = run(
            &registry,
            &budget,
            QueueStartRequest {
                queued_submission_id: Some("queue-a".into()),
                ..request()
            },
            async move {
                let result = codex::start_queued_submission(&connection, "task", Some("queue-a"))
                    .await
                    .map_err(AppError::from)?;
                serde_json::to_value(result).map_err(|_| AppError::CodexRequestFailed)
            },
        )
        .await
        .unwrap();
        assert_eq!(response["turn"]["id"], "turn");
    }
    drop(connection);
    peer.await.unwrap();
}
