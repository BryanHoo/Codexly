use super::*;
use serde_json::json;
use std::sync::atomic::{AtomicUsize, Ordering};

fn request() -> QueuedSteerRequest {
    QueuedSteerRequest {
        project_id: "project".into(),
        task_id: "task".into(),
        turn_id: "turn".into(),
        input: AgentPromptInput::text("hello"),
        idempotency_key: "key".into(),
        queued_submission_id: "queue".into(),
    }
}

#[tokio::test]
async fn queued_steer_should_reject_changed_content_even_with_a_new_key() {
    let registry = Arc::new(QueuedSteerRegistry::default());
    let budget = SubmissionBudget::default();
    run(
        registry.clone(),
        &budget,
        request(),
        |_| async { Ok(json!({})) },
        || async { Ok(()) },
    )
    .await
    .unwrap();
    let mut changed = request();
    changed.idempotency_key = "new-key".into();
    changed.input = AgentPromptInput::text("edited");
    let error = run(
        registry,
        &budget,
        changed,
        |_| async { panic!("accepted queue item must not steer") },
        || async { panic!("edited queue item must not be deleted") },
    )
    .await
    .unwrap_err();
    assert_eq!(error["code"], "IDEMPOTENCY_CONFLICT");
}

#[tokio::test]
async fn queued_steer_should_not_replace_an_unconfirmed_attempt_with_a_new_key() {
    let registry = Arc::new(QueuedSteerRegistry::default());
    let budget = SubmissionBudget::default();
    run(
        registry.clone(),
        &budget,
        request(),
        |_| async { Err(AppError::CodexRequestFailed) },
        || async { panic!("unconfirmed input must remain queued") },
    )
    .await
    .unwrap_err();
    let mut retry = request();
    retry.idempotency_key = "new-key".into();
    let error = run(
        registry,
        &budget,
        retry,
        |_| async { panic!("unknown acceptance must not be retried with a new key") },
        || async { panic!("unknown acceptance must not delete") },
    )
    .await
    .unwrap_err();
    assert_eq!(error["code"], "TURN_START_UNCERTAIN");
}

#[tokio::test]
async fn queued_steer_should_serialize_different_keys_for_the_same_queue_item() {
    let registry = Arc::new(QueuedSteerRegistry::default());
    let budget = SubmissionBudget::default();
    let mut second = request();
    second.idempotency_key = "second-key".into();
    let entered = Arc::new(tokio::sync::Notify::new());
    let worker_entered = entered.clone();
    let first = run(
        registry.clone(),
        &budget,
        request(),
        move |_| async move {
            worker_entered.notify_one();
            tokio::task::yield_now().await;
            Ok(json!({"status":"accepted"}))
        },
        || async { Ok(()) },
    );
    let second = async {
        entered.notified().await;
        run(
            registry,
            &budget,
            second,
            |_| async { panic!("concurrent retry must not steer twice") },
            || async { Ok(()) },
        )
        .await
    };
    let (first, second) = tokio::join!(first, second);
    assert!(first.is_ok());
    assert!(second.is_ok());
}

#[tokio::test]
async fn queued_steer_should_isolate_recovery_by_project_and_task() {
    let registry = Arc::new(QueuedSteerRegistry::default());
    let budget = SubmissionBudget::default();
    let calls = Arc::new(AtomicUsize::new(0));
    for index in 0..3 {
        let mut input = request();
        input.idempotency_key = format!("key-{index}");
        if index == 1 {
            input.project_id = "other-project".into();
        }
        if index == 2 {
            input.task_id = "other-task".into();
        }
        let calls = calls.clone();
        run(
            registry.clone(),
            &budget,
            input,
            move |_| async move {
                calls.fetch_add(1, Ordering::SeqCst);
                Ok(json!({}))
            },
            || async { Ok(()) },
        )
        .await
        .unwrap();
    }
    assert_eq!(calls.load(Ordering::SeqCst), 3);
}

#[tokio::test]
async fn queued_steer_should_recover_cleanup_after_key_and_turn_change() {
    let registry = Arc::new(QueuedSteerRegistry::default());
    let budget = SubmissionBudget::default();
    let calls = Arc::new(AtomicUsize::new(0));
    for attempt in 0..2 {
        let mut input = request();
        if attempt == 1 {
            input.idempotency_key = "new-ui-key".into();
            input.turn_id = "next-turn".into();
        }
        let calls = calls.clone();
        let result = run(
            registry.clone(),
            &budget,
            input,
            move |_| async move {
                calls.fetch_add(1, Ordering::SeqCst);
                Ok(json!({"status":"accepted"}))
            },
            move || async move {
                if attempt == 0 {
                    Err(AppError::CodexRequestFailed)
                } else {
                    Ok(())
                }
            },
        )
        .await;
        assert_eq!(result.is_ok(), attempt == 1);
        if attempt == 1 {
            assert_eq!(result.unwrap()["cleanupOnly"], true);
        }
    }
    assert_eq!(calls.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn queued_steer_should_retry_only_delete_on_native_transport() {
    use crate::infrastructure::codex;
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, duplex, split};
    let (client, server) = duplex(8192);
    let (reader, writer) = split(client);
    let connection = Arc::new(codex::AppServerConnection::new(reader, writer));
    let (reader, mut writer) = split(server);
    let peer = tokio::spawn(async move {
        let mut lines = BufReader::new(reader).lines();
        for (index, method) in ["turn/steer", "thread/queue/delete", "thread/queue/delete"]
            .into_iter()
            .enumerate()
        {
            let request: Value =
                serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
            assert_eq!(request["method"], method);
            assert_eq!(request["params"]["threadId"], "task");
            if index > 0 {
                assert_eq!(request["params"]["queuedSubmissionId"], "queue");
            }
            let response = match index {
                0 => json!({"id":request["id"], "result":{"turnId":"turn"}}),
                1 => json!({"id":request["id"], "error":{"code":-32000,"message":"delete failed"}}),
                // 重试时队列项已不存在也视为清理完成。
                _ => json!({"id":request["id"], "result":{"deleted":false}}),
            };
            writer
                .write_all(format!("{response}\n").as_bytes())
                .await
                .unwrap();
        }
        assert!(lines.next_line().await.unwrap().is_none());
    });
    let registry = Arc::new(QueuedSteerRegistry::default());
    let budget = SubmissionBudget::default();
    for attempt in 0..2 {
        let steer_connection = connection.clone();
        let cleanup_connection = connection.clone();
        let result = run(
            registry.clone(),
            &budget,
            request(),
            move |input| async move {
                let result =
                    codex::steer_turn(&steer_connection, "task".into(), "turn".into(), input)
                        .await
                        .map_err(AppError::from)?;
                serde_json::to_value(result).map_err(|_| AppError::CodexRequestFailed)
            },
            move || async move {
                codex::delete_queued_submission(&cleanup_connection, "task", "queue")
                    .await
                    .map_err(AppError::from)?;
                Ok(())
            },
        )
        .await;
        assert_eq!(result.is_ok(), attempt == 1);
    }
    drop(connection);
    peer.await.unwrap();
}

#[tokio::test]
async fn queued_steer_should_retry_cleanup_without_repeating_accepted_steer() {
    let registry = Arc::new(QueuedSteerRegistry::default());
    let budget = SubmissionBudget::default();
    let steers = Arc::new(AtomicUsize::new(0));
    for attempt in 0..2 {
        let calls = Arc::clone(&steers);
        let result = run(
            Arc::clone(&registry),
            &budget,
            request(),
            move |_| async move {
                calls.fetch_add(1, Ordering::SeqCst);
                Ok(json!({"status":"accepted"}))
            },
            move || async move {
                if attempt == 0 {
                    Err(AppError::CodexRequestFailed)
                } else {
                    Ok(())
                }
            },
        )
        .await;
        assert_eq!(result.is_ok(), attempt == 1);
        if attempt == 0 {
            assert_eq!(result.unwrap_err()["code"], "QUEUE_CLEANUP_FAILED");
        }
    }
    assert_eq!(steers.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn queued_steer_should_not_cleanup_rejected_input() {
    let result = run(
        Arc::default(),
        &SubmissionBudget::default(),
        request(),
        |_| async { Err(AppError::CodexRequestFailed) },
        || async { panic!("rejected input must remain queued") },
    )
    .await;
    assert!(result.is_err());
}

#[tokio::test]
async fn queued_steer_should_bind_queue_turn_and_input_to_key() {
    let registry = Arc::new(QueuedSteerRegistry::default());
    let budget = SubmissionBudget::default();
    run(
        registry.clone(),
        &budget,
        request(),
        |_| async { Ok(json!({})) },
        || async { Ok(()) },
    )
    .await
    .unwrap();
    for field in 0..3 {
        let mut changed = request();
        match field {
            0 => changed.queued_submission_id = "another-queue".into(),
            1 => changed.turn_id = "another-turn".into(),
            _ => changed.input = AgentPromptInput::text("different"),
        }
        let error = run(
            registry.clone(),
            &budget,
            changed,
            |_| async { panic!("conflict must not steer") },
            || async { panic!("conflict must not delete") },
        )
        .await
        .unwrap_err();
        assert_eq!(error["code"], "IDEMPOTENCY_CONFLICT");
    }
}

#[tokio::test]
async fn queued_steer_should_finish_cleanup_after_caller_cancellation() {
    let entered = Arc::new(tokio::sync::Notify::new());
    let release = Arc::new(tokio::sync::Notify::new());
    let (finished, done) = tokio::sync::oneshot::channel();
    let worker_entered = entered.clone();
    let worker_release = release.clone();
    let caller = tokio::spawn(async move {
        run(
            Arc::default(),
            &SubmissionBudget::default(),
            request(),
            |_| async { Ok(json!({})) },
            move || async move {
                worker_entered.notify_one();
                worker_release.notified().await;
                finished.send(()).unwrap();
                Ok(())
            },
        )
        .await
    });
    entered.notified().await;
    caller.abort();
    release.notify_one();
    tokio::time::timeout(std::time::Duration::from_secs(1), done)
        .await
        .unwrap()
        .unwrap();
}

#[tokio::test]
async fn queued_steer_should_reject_invalid_queue_identity_before_execution() {
    for id in [String::new(), "x".repeat(1025)] {
        let mut invalid = request();
        invalid.queued_submission_id = id;
        let error = run(
            Arc::default(),
            &SubmissionBudget::default(),
            invalid,
            |_| async { panic!("invalid input must not steer") },
            || async { panic!("invalid input must not delete") },
        )
        .await
        .unwrap_err();
        assert_eq!(error["code"], "INVALID_REQUEST");
    }
}
