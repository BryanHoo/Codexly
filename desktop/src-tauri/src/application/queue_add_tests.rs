use super::*;

#[tokio::test]
async fn only_unavailable_runtime_allows_retry() {
    let registry = TurnStartRegistry::default();
    let budget = SubmissionBudget::default();
    assert!(
        run(&registry, &budget, request(), |_| async {
            Err(AppError::CodexRuntimeUnavailable)
        })
        .await
        .is_err()
    );
    let error = run(&registry, &budget, request(), |_| async {
        Err(AppError::CodexRequestFailed)
    })
    .await
    .unwrap_err();
    assert_eq!(
        run(&registry, &budget, request(), |_| async {
            panic!("uncertain failure must replay")
        })
        .await
        .unwrap_err(),
        error
    );
}
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};

fn request() -> QueueAddRequest {
    QueueAddRequest {
        project_id: "project".into(),
        task_id: "task".into(),
        client_user_message_id: "message".into(),
        idempotency_key: "add".into(),
        input: AgentPromptInput {
            text: "hello".into(),
            attachments: vec![],
            skills: vec![],
        },
    }
}

#[tokio::test]
async fn replay_and_full_identity_conflicts_do_not_repeat_add() {
    let registry = TurnStartRegistry::default();
    let budget = SubmissionBudget::default();
    let result = json!({"queuedSubmission": {"id": "queued"}});
    let expected = result.clone();
    assert_eq!(
        run(&registry, &budget, request(), |_| async move { Ok(result) })
            .await
            .unwrap(),
        expected
    );
    assert_eq!(
        run(&registry, &budget, request(), |_| async {
            panic!("must replay")
        })
        .await
        .unwrap(),
        expected
    );
    for field in 0..6 {
        let mut changed = request();
        match field {
            0 => changed.project_id.push('2'),
            1 => changed.task_id.push('2'),
            2 => changed.client_user_message_id.push('2'),
            3 => changed.input.text.push('2'),
            4 => changed.input.attachments.push(json!({"id":"attachment"})),
            _ => changed.input.skills.push(json!({"id":"skill"})),
        }
        let error = run(&registry, &budget, changed, |_| async {
            panic!("conflict must not execute")
        })
        .await
        .unwrap_err();
        assert_eq!(error["code"], "IDEMPOTENCY_CONFLICT");
    }
}

#[tokio::test]
async fn cancellation_keeps_registered_work_alive() {
    let registry = Arc::new(TurnStartRegistry::default());
    let budget = Arc::new(SubmissionBudget::default());
    let calls = Arc::new(AtomicUsize::new(0));
    let (started_tx, started_rx) = tokio::sync::oneshot::channel();
    let (release_tx, release_rx) = tokio::sync::oneshot::channel();
    let worker_registry = registry.clone();
    let worker_budget = budget.clone();
    let worker_calls = calls.clone();
    let waiter = tokio::spawn(async move {
        run(
            &worker_registry,
            &worker_budget,
            request(),
            |_| async move {
                worker_calls.fetch_add(1, Ordering::SeqCst);
                started_tx.send(()).unwrap();
                release_rx.await.unwrap();
                Ok(json!({"id":"queued"}))
            },
        )
        .await
    });
    started_rx.await.unwrap();
    waiter.abort();
    let _ = waiter.await;
    // 取消等待仍占用一个请求许可，直到后台操作完成。
    let permits: Vec<_> = (0..15).map(|_| budget.reserve(1).unwrap()).collect();
    assert!(budget.reserve(1).is_err());
    drop(permits);
    release_tx.send(()).unwrap();
    assert_eq!(
        run(&registry, &budget, request(), |_| async {
            panic!("must join original")
        })
        .await
        .unwrap(),
        json!({"id":"queued"})
    );
    assert_eq!(calls.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn reject_invalid_identity_before_execution() {
    let registry = TurnStartRegistry::default();
    let budget = SubmissionBudget::default();
    let mut invalid = request();
    invalid.client_user_message_id = " ".into();
    assert_eq!(
        run(&registry, &budget, invalid, |_| async { panic!("invalid") })
            .await
            .unwrap_err()["code"],
        "INVALID_REQUEST"
    );
}
