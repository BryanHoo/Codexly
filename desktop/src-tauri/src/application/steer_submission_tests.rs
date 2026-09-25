use super::*;
use serde_json::json;
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};

fn request() -> SteerRequest {
    SteerRequest {
        project_id: "project".into(),
        task_id: "task".into(),
        turn_id: "turn".into(),
        input: AgentPromptInput::text("hello"),
        idempotency_key: "key".into(),
    }
}

#[tokio::test]
async fn steer_submission_should_execute_only_once_for_repeated_input() {
    let registry = TurnStartRegistry::default();
    let budget = SubmissionBudget::default();
    let calls = Arc::new(AtomicUsize::new(0));
    for _ in 0..2 {
        let calls = Arc::clone(&calls);
        let response = run(&registry, &budget, request(), move |_| async move {
            calls.fetch_add(1, Ordering::SeqCst);
            Ok(json!({"status":"accepted", "taskId":"task", "turnId":"turn"}))
        })
        .await
        .unwrap();
        assert_eq!(response["status"], "accepted");
    }
    assert_eq!(calls.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn steer_submission_should_reject_changed_scope_turn_text_attachments_or_skills() {
    let registry = TurnStartRegistry::default();
    let budget = SubmissionBudget::default();
    run(&registry, &budget, request(), |_| async { Ok(json!({})) })
        .await
        .unwrap();
    let changed = [
        SteerRequest {
            project_id: "other".into(),
            ..request()
        },
        SteerRequest {
            task_id: "other".into(),
            ..request()
        },
        SteerRequest {
            turn_id: "other".into(),
            ..request()
        },
        SteerRequest {
            input: AgentPromptInput::text("changed"),
            ..request()
        },
        SteerRequest {
            input: AgentPromptInput {
                attachments: vec![json!({"id":"attachment"})],
                ..AgentPromptInput::text("hello")
            },
            ..request()
        },
        SteerRequest {
            input: AgentPromptInput {
                skills: vec![json!({"id":"skill"})],
                ..AgentPromptInput::text("hello")
            },
            ..request()
        },
    ];
    for request in changed {
        let error = run(&registry, &budget, request, |_| async {
            panic!("conflicting input must not execute")
        })
        .await
        .unwrap_err();
        assert_eq!(error["code"], "IDEMPOTENCY_CONFLICT");
    }
}

#[tokio::test]
async fn steer_submission_should_reject_invalid_identity_key_and_input_before_execution() {
    let registry = TurnStartRegistry::default();
    let budget = SubmissionBudget::default();
    for request in [
        SteerRequest {
            project_id: String::new(),
            ..request()
        },
        SteerRequest {
            task_id: "x".repeat(1025),
            ..request()
        },
        SteerRequest {
            turn_id: String::new(),
            ..request()
        },
        SteerRequest {
            turn_id: "x".repeat(1025),
            ..request()
        },
        SteerRequest {
            idempotency_key: " ".into(),
            ..request()
        },
        SteerRequest {
            idempotency_key: "x".repeat(129),
            ..request()
        },
        SteerRequest {
            input: AgentPromptInput::text(&"x".repeat(4 * 1024 * 1024)),
            ..request()
        },
    ] {
        let error = run(&registry, &budget, request, |_| async {
            panic!("invalid request must not execute")
        })
        .await
        .unwrap_err();
        assert_eq!(error["code"], "INVALID_REQUEST");
    }
}

#[tokio::test]
async fn steer_submission_should_share_admission_budget_and_release_rejected_reservations() {
    let registry = TurnStartRegistry::default();
    let budget = SubmissionBudget::default();
    let full = budget.reserve(8 * 1024 * 1024).unwrap();
    let error = run(&registry, &budget, request(), |_| async {
        panic!("capacity rejection must precede execution")
    })
    .await
    .unwrap_err();
    assert_eq!(error["code"], "IDEMPOTENCY_CAPACITY_EXCEEDED");
    drop(full);
    assert!(
        run(&registry, &budget, request(), |_| async { Ok(json!({})) })
            .await
            .is_ok()
    );
    assert!(budget.reserve(8 * 1024 * 1024).is_ok());
}

#[tokio::test]
async fn steer_submission_should_retry_runtime_unavailable_but_replay_rpc_failure() {
    let registry = TurnStartRegistry::default();
    let budget = SubmissionBudget::default();
    assert!(
        run(&registry, &budget, request(), |_| async {
            Err(AppError::CodexRuntimeUnavailable)
        })
        .await
        .is_err()
    );
    let expected = run(&registry, &budget, request(), |_| async {
        Err(AppError::CodexRpc {
            rpc_code: -32000,
            message: "runtime unavailable".into(),
        })
    })
    .await
    .unwrap_err();
    let replay = run(&registry, &budget, request(), |_| async {
        panic!("RPC text must not permit another steer")
    })
    .await
    .unwrap_err();
    assert_eq!(replay, expected);
}

#[tokio::test]
async fn steer_submission_should_keep_one_worker_when_waiter_is_cancelled() {
    let registry = Arc::new(TurnStartRegistry::default());
    let budget = Arc::new(SubmissionBudget::default());
    let worker_registry = Arc::clone(&registry);
    let worker_budget = Arc::clone(&budget);
    let (entered_tx, entered_rx) = tokio::sync::oneshot::channel();
    let (finish_tx, finish_rx) = tokio::sync::oneshot::channel();
    let waiter = tokio::spawn(async move {
        run(
            &worker_registry,
            &worker_budget,
            request(),
            |_| async move {
                entered_tx.send(()).unwrap();
                finish_rx.await.unwrap();
                Ok(json!({"status":"accepted"}))
            },
        )
        .await
    });
    entered_rx.await.unwrap();
    waiter.abort();
    let _ = waiter.await;
    finish_tx.send(()).unwrap();
    let response = run(&registry, &budget, request(), |_| async {
        panic!("cancelled waiter must not restart steer")
    })
    .await
    .unwrap();
    assert_eq!(response["status"], "accepted");
}

#[tokio::test]
async fn steer_submission_should_send_only_one_rpc_with_the_expected_turn() {
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
        assert_eq!(request["method"], "turn/steer");
        assert_eq!(request["params"]["threadId"], "task");
        assert_eq!(request["params"]["expectedTurnId"], "turn");
        assert_eq!(request["params"]["input"][0]["text"], "hello");
        writer
            .write_all(
                format!(
                    "{}\n",
                    json!({"id":request["id"],"result":{"turnId":"turn"}})
                )
                .as_bytes(),
            )
            .await
            .unwrap();
        assert!(
            lines.next_line().await.unwrap().is_none(),
            "replay must not send another turn/steer"
        );
    });
    let registry = TurnStartRegistry::default();
    let budget = SubmissionBudget::default();
    for _ in 0..2 {
        let connection = Arc::clone(&connection);
        let response = run(&registry, &budget, request(), move |input| async move {
            let response = codex::steer_turn(&connection, "task".into(), "turn".into(), input)
                .await
                .map_err(AppError::from)?;
            serde_json::to_value(response).map_err(|_| AppError::CodexRequestFailed)
        })
        .await
        .unwrap();
        assert_eq!(
            response,
            json!({"status":"accepted", "taskId":"task", "turnId":"turn"})
        );
    }
    drop(connection);
    peer.await.unwrap();
}
