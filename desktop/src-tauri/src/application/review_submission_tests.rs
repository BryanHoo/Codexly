use super::*;
use serde_json::json;
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};

#[test]
fn review_submission_should_validate_all_targets_and_reject_invalid_requests_before_creation() {
    for target in [
        json!({"type":"uncommitted_changes"}),
        json!({"type":"base_branch", "branch":"main"}),
        json!({"type":"commit", "sha":"abc", "title":"change"}),
        json!({"type":"custom", "instructions":"check safety"}),
    ] {
        let request = ReviewRequest {
            project_id: "project".into(),
            task_id: None,
            target,
            idempotency_key: "key".into(),
        };
        assert!(request.validate().is_ok());
    }
    for target in [
        json!(null),
        json!({"type":"unknown"}),
        json!({"type":"base_branch"}),
        json!({"type":"commit","sha":""}),
        json!({"type":"custom","instructions":7}),
        json!({"type":"uncommitted_changes","extra":"x"}),
    ] {
        assert_eq!(
            validate_target(&target).unwrap_err()["code"],
            "INVALID_REQUEST"
        );
    }
    let mut request = ReviewRequest {
        project_id: "project".into(),
        task_id: None,
        target: json!({"type":"custom","instructions":"x".repeat(4*1024*1024)}),
        idempotency_key: "key".into(),
    };
    assert!(request.validate().is_err());
    request.target = json!({"type":"uncommitted_changes"});
    request.idempotency_key = " ".into();
    assert!(request.validate().is_err());
    request.idempotency_key = "x".repeat(129);
    assert!(request.validate().is_err());
    request.idempotency_key = "key".into();
    request.task_id = Some(String::new());
    assert!(request.validate().is_err());
}

#[tokio::test]
async fn review_submission_should_reject_changed_project_task_or_target_for_the_same_key() {
    let registry = TurnStartRegistry::default();
    start(
        &registry,
        "key",
        "project",
        "task",
        json!({"type":"commit", "sha":"abc", "title":"one"}),
        |_| async { Ok(json!({})) },
    )
    .await
    .unwrap();
    for (project, task, target) in [
        (
            "other",
            "task",
            json!({"type":"commit","sha":"abc","title":"one"}),
        ),
        (
            "project",
            "other",
            json!({"type":"commit","sha":"abc","title":"one"}),
        ),
        (
            "project",
            "task",
            json!({"type":"commit","sha":"abc","title":"two"}),
        ),
        (
            "project",
            "task",
            json!({"type":"base_branch","branch":"main"}),
        ),
    ] {
        let error = start(&registry, "key", project, task, target, |_| async {
            panic!("conflicting Review must not execute")
        })
        .await
        .unwrap_err();
        assert_eq!(error["code"], "IDEMPOTENCY_CONFLICT");
    }
}

#[tokio::test]
async fn review_submission_should_preserve_failure_and_created_task_on_replay() {
    let registry = TurnStartRegistry::default();
    for attempt in 0..2 {
        let registry = &registry;
        let response = submit(
            None,
            async {
                Ok(crate::domain::sidebar::AgentTaskMutationResponse {
                    task: AgentTask {
                        id: "task".into(),
                        project_id: "project".into(),
                        title: "Review".into(),
                        pinned: false,
                        updated_at: "now".into(),
                    },
                })
            },
            |_| {},
            |task| async move {
                start(
                    registry,
                    "key",
                    "project",
                    &task,
                    json!({"type":"uncommitted_changes"}),
                    move |_| async move {
                        assert_eq!(attempt, 0, "failure must be replayed");
                        Err(AppError::CodexRequestFailed)
                    },
                )
                .await
            },
        )
        .await
        .unwrap();
        let response = serde_json::to_value(response).unwrap();
        assert_eq!(response["createdTask"]["id"], "task");
        assert_eq!(response["outcome"]["type"], "failed");
    }
}

#[tokio::test]
async fn review_submission_should_retry_only_after_native_runtime_unavailable() {
    let registry = TurnStartRegistry::default();
    let target = json!({"type":"uncommitted_changes"});
    assert!(
        start(
            &registry,
            "key",
            "project",
            "task",
            target.clone(),
            |_| async { Err(AppError::CodexRuntimeUnavailable) }
        )
        .await
        .is_err()
    );
    assert_eq!(
        start(&registry, "key", "project", "task", target, |_| async {
            Ok(json!({"recovered":true}))
        })
        .await
        .unwrap()["recovered"],
        true
    );
}

#[tokio::test]
async fn review_submission_should_keep_worker_after_waiter_cancellation() {
    let registry = Arc::new(TurnStartRegistry::default());
    let worker_registry = Arc::clone(&registry);
    let (entered_tx, entered_rx) = tokio::sync::oneshot::channel();
    let (finish_tx, finish_rx) = tokio::sync::oneshot::channel();
    let waiter = tokio::spawn(async move {
        start(
            &worker_registry,
            "key",
            "project",
            "task",
            json!({"type":"uncommitted_changes"}),
            |_| async move {
                entered_tx.send(()).unwrap();
                finish_rx.await.unwrap();
                Ok(json!({"turn":"review"}))
            },
        )
        .await
    });
    entered_rx.await.unwrap();
    waiter.abort();
    let _ = waiter.await;
    finish_tx.send(()).unwrap();
    let replay = start(
        &registry,
        "key",
        "project",
        "task",
        json!({"type":"uncommitted_changes"}),
        |_| async { panic!("cancelled waiter must not restart Review") },
    )
    .await
    .unwrap();
    assert_eq!(replay["turn"], "review");
}

#[tokio::test]
async fn review_submission_should_send_only_one_review_rpc_for_repeated_submission() {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, duplex, split};
    let (client, server) = duplex(8192);
    let (reader, writer) = split(client);
    let connection = Arc::new(codex::AppServerConnection::new(reader, writer));
    let (reader, mut writer) = split(server);
    let peer = tokio::spawn(async move {
        let mut lines = BufReader::new(reader).lines();
        for (method, result) in [
            (
                "thread/read",
                json!({"thread":{"id":"task", "projectId":"project", "name":null,"preview":"Review","section":null,"status":{"type":"idle"},"updatedAt":1735689600}}),
            ),
            (
                "review/start",
                json!({"reviewThreadId":"task","turn":{"id":"review", "status":"inProgress","startedAt":1735689600,"completedAt":null,"error":null,"items":[]}}),
            ),
        ] {
            let request: Value =
                serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
            assert_eq!(request["method"], method);
            if method == "review/start" {
                assert_eq!(
                    request["params"]["target"],
                    json!({"type":"baseBranch","branch":"main"})
                );
                assert_eq!(request["params"]["threadId"], "task");
            }
            writer
                .write_all(format!("{}\n", json!({"id":request["id"],"result":result})).as_bytes())
                .await
                .unwrap();
        }
        assert!(
            lines.next_line().await.unwrap().is_none(),
            "replay must not repeat thread/read or review/start"
        );
    });
    let registry = TurnStartRegistry::default();
    for _ in 0..2 {
        let connection = Arc::clone(&connection);
        let result = start(
            &registry,
            "key",
            "project",
            "task",
            json!({"type":"base_branch","branch":"main"}),
            move |target| async move {
                let response = codex::start_review(&connection, "project", "task", &target)
                    .await
                    .map_err(AppError::from)?;
                serde_json::to_value(response).map_err(|_| AppError::CodexRequestFailed)
            },
        )
        .await
        .unwrap();
        assert_eq!(result["turn"]["id"], "review");
    }
    drop(connection);
    peer.await.unwrap();
}

#[tokio::test]
async fn review_submission_should_replay_without_executing_twice() {
    let registry = TurnStartRegistry::default();
    let calls = Arc::new(AtomicUsize::new(0));
    for _ in 0..2 {
        let observed = Arc::clone(&calls);
        let result = start(
            &registry,
            "key",
            "project",
            "task",
            json!({"type":"uncommitted_changes"}),
            move |_| async move {
                observed.fetch_add(1, Ordering::SeqCst);
                Ok(json!({"taskId":"task", "turn":{"id":"review"}}))
            },
        )
        .await
        .unwrap();
        assert_eq!(result["turn"]["id"], "review");
    }
    assert_eq!(calls.load(Ordering::SeqCst), 1);
}
