use super::*;
use serde_json::json;
use std::sync::atomic::{AtomicUsize, Ordering};

fn request() -> QueueStartRequest {
    QueueStartRequest {
        project_id: "project".into(),
        task_id: "task".into(),
        queued_submission_id: None,
        idempotency_key: "key".into(),
    }
}

#[tokio::test]
async fn idle_cleanup_should_continue_after_cancellation_and_hold_budget() {
    let registry = Arc::new(TurnStartRegistry::default());
    let budget = Arc::new(SubmissionBudget::default());
    let worker_budget = budget.clone();
    let (entered, entered_rx) = tokio::sync::oneshot::channel();
    let (release, released) = tokio::sync::oneshot::channel();
    let (done, finished) = tokio::sync::oneshot::channel();
    let waiter = tokio::spawn(async move {
        run(
            &registry,
            &worker_budget,
            request(),
            async { Ok(json!({"cleanupOnly":true,"queuedSubmissionId":"original"})) },
            move |_| async move {
                entered.send(()).unwrap();
                released.await.unwrap();
                done.send(()).unwrap();
                Ok(())
            },
        )
        .await
    });
    entered_rx.await.unwrap();
    waiter.abort();
    assert!(budget.reserve(8 * 1024 * 1024).is_err());
    release.send(()).unwrap();
    tokio::time::timeout(std::time::Duration::from_secs(1), finished)
        .await
        .unwrap()
        .unwrap();
}

#[tokio::test]
async fn idle_cleanup_should_retry_only_the_original_selected_item() {
    let registry = Arc::new(TurnStartRegistry::default());
    let budget = SubmissionBudget::default();
    let selections = Arc::new(AtomicUsize::new(0));
    let deletes = Arc::new(AtomicUsize::new(0));
    for attempt in 0..2 {
        let selections = selections.clone();
        let deletes = deletes.clone();
        let result = run(
            &registry,
            &budget,
            request(),
            async move {
                selections.fetch_add(1, Ordering::SeqCst);
                Ok(json!({"cleanupOnly":true, "taskId":"task", "queuedSubmissionId":"original"}))
            },
            move |id| async move {
                assert_eq!(id, "original");
                deletes.fetch_add(1, Ordering::SeqCst);
                if attempt == 0 {
                    Err(json!({"code":"QUEUE_CLEANUP_FAILED"}))
                } else {
                    Ok(())
                }
            },
        )
        .await;
        assert_eq!(result.is_ok(), attempt == 1);
    }
    assert_eq!(selections.load(Ordering::SeqCst), 1);
    assert_eq!(deletes.load(Ordering::SeqCst), 2);
}
