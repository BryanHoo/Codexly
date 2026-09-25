use super::*;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, duplex, split};

fn item(id: &str, text: &str) -> Value {
    json!({"id":id,"clientUserMessageId":format!("message-{id}"),"input":[{"type":"text","text":text,"text_elements":[]}]})
}

#[tokio::test]
async fn queue_consumption_should_block_steer_after_idle_selection() {
    let registry = Arc::new(QueuedSteerRegistry::default());
    let (connection, server) = peer(vec![]);
    let selected = select(
        &registry,
        &connection,
        "project",
        "task",
        Some("queue".into()),
    )
    .await
    .unwrap();
    // RPC 结果可能丢失；释放等待租约不能让新键再次消费同一项。
    drop(selected);
    let result = super::super::queued_steer::run(
        registry,
        &super::super::prompt_submission::SubmissionBudget::default(),
        super::super::queued_steer::QueuedSteerRequest {
            project_id: "project".into(),
            task_id: "task".into(),
            turn_id: "turn".into(),
            input: AgentPromptInput::text("hello"),
            idempotency_key: "new-steer".into(),
            queued_submission_id: "queue".into(),
        },
        |_| async { Ok(json!({"status":"accepted"})) },
        || async { Ok(()) },
    )
    .await;
    assert!(
        result.is_err(),
        "idle selection must reserve this item against steer"
    );
    drop(connection);
    server.await.unwrap();
}

fn peer(
    responses: Vec<(&'static str, Value)>,
) -> (codex::AppServerConnection, tokio::task::JoinHandle<()>) {
    let (client, server) = duplex(8192);
    let (reader, writer) = split(client);
    let connection = codex::AppServerConnection::new(reader, writer);
    let (reader, mut writer) = split(server);
    let task = tokio::spawn(async move {
        let mut lines = BufReader::new(reader).lines();
        for (method, result) in responses {
            let request: Value =
                serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
            assert_eq!(request["method"], method);
            assert_eq!(request["params"]["threadId"], "task");
            if method == "thread/queue/delete" {
                assert_eq!(request["params"]["queuedSubmissionId"], "queue");
            }
            writer
                .write_all(format!("{}\n", json!({"id":request["id"],"result":result})).as_bytes())
                .await
                .unwrap();
        }
        assert!(
            lines.next_line().await.unwrap().is_none(),
            "recovery must not start another turn"
        );
    });
    (connection, task)
}

async fn accepted_registry() -> Arc<QueuedSteerRegistry> {
    let registry = Arc::new(QueuedSteerRegistry::default());
    super::super::queued_steer::run(
        registry.clone(),
        &super::super::prompt_submission::SubmissionBudget::default(),
        super::super::queued_steer::QueuedSteerRequest {
            project_id: "project".into(),
            task_id: "task".into(),
            turn_id: "turn".into(),
            input: AgentPromptInput::text("hello"),
            idempotency_key: "steer".into(),
            queued_submission_id: "queue".into(),
        },
        |_| async { Ok(json!({"status":"accepted"})) },
        || async { Err(AppError::CodexRequestFailed) },
    )
    .await
    .unwrap_err();
    registry
}

#[tokio::test]
async fn idle_recovery_should_choose_cleanup_for_previously_accepted_item() {
    let registry = accepted_registry().await;
    let (client, _server) = tokio::io::duplex(8192);
    let (reader, writer) = tokio::io::split(client);
    let connection = codex::AppServerConnection::new(reader, writer);
    assert!(
        matches!(select(&registry, &connection, "project", "task", Some("queue".into())).await.unwrap(), Selection::Cleanup(id) if id == "queue")
    );
}

#[tokio::test]
async fn idle_recovery_should_delete_accepted_input_without_starting_a_turn() {
    let registry = accepted_registry().await;
    let (connection, server) = peer(vec![
        (
            "thread/queue/list",
            json!({"data":[item("queue","hello")],"nextCursor":null}),
        ),
        ("thread/queue/delete", json!({"deleted":true})),
    ]);
    cleanup(&registry, &connection, "project", "task", "queue")
        .await
        .unwrap();
    drop(connection);
    server.await.unwrap();
}

#[tokio::test]
async fn idle_recovery_should_preserve_edited_content() {
    let registry = accepted_registry().await;
    let (connection, server) = peer(vec![(
        "thread/queue/list",
        json!({"data":[item("queue","edited")],"nextCursor":null}),
    )]);
    let error = cleanup(&registry, &connection, "project", "task", "queue")
        .await
        .unwrap_err();
    assert_eq!(error["code"], "IDEMPOTENCY_CONFLICT");
    drop(connection);
    server.await.unwrap();
}

#[tokio::test]
async fn idle_recovery_should_treat_an_absent_item_as_cleaned() {
    let registry = accepted_registry().await;
    let (connection, server) = peer(vec![(
        "thread/queue/list",
        json!({"data":[],"nextCursor":null}),
    )]);
    cleanup(&registry, &connection, "project", "task", "queue")
        .await
        .unwrap();
    drop(connection);
    server.await.unwrap();
}

#[tokio::test]
async fn idle_recovery_should_select_the_first_item_and_not_skip_accepted_input() {
    let registry = accepted_registry().await;
    let (connection, server) = peer(vec![(
        "thread/queue/list",
        json!({"data":[item("queue","hello"),item("next","later")],"nextCursor":null}),
    )]);
    assert!(
        matches!(select(&registry,&connection,"project","task",None).await.unwrap(), Selection::Cleanup(id) if id == "queue")
    );
    drop(connection);
    server.await.unwrap();
}

#[tokio::test]
async fn idle_recovery_should_pin_an_unaccepted_first_item_for_start() {
    let registry = accepted_registry().await;
    let (connection, server) = peer(vec![(
        "thread/queue/list",
        json!({"data":[item("new","new prompt"),item("queue","hello")],"nextCursor":null}),
    )]);
    assert!(
        matches!(select(&registry,&connection,"project","task",None).await.unwrap(), Selection::Start(id, _) if id == "new")
    );
    drop(connection);
    server.await.unwrap();
}

#[tokio::test]
async fn idle_recovery_should_reject_an_empty_queue_without_unpinned_start() {
    let (connection, server) = peer(vec![(
        "thread/queue/list",
        json!({"data":[],"nextCursor":null}),
    )]);
    assert!(matches!(
        select(
            &QueuedSteerRegistry::default(),
            &connection,
            "project",
            "task",
            None
        )
        .await,
        Err(AppError::QueueEmpty)
    ));
    drop(connection);
    server.await.unwrap();
}

#[tokio::test]
async fn idle_recovery_should_block_unknown_acceptance_and_keep_scope_isolation() {
    let registry = Arc::new(QueuedSteerRegistry::default());
    super::super::queued_steer::run(
        registry.clone(),
        &super::super::prompt_submission::SubmissionBudget::default(),
        super::super::queued_steer::QueuedSteerRequest {
            project_id: "project".into(),
            task_id: "task".into(),
            turn_id: "turn".into(),
            input: AgentPromptInput::text("hello"),
            idempotency_key: "steer".into(),
            queued_submission_id: "queue".into(),
        },
        |_| async { Err(AppError::CodexRequestFailed) },
        || async { panic!("unconfirmed steer must not delete") },
    )
    .await
    .unwrap_err();
    let (connection, server) = peer(vec![]);
    assert!(matches!(
        select(
            &registry,
            &connection,
            "project",
            "task",
            Some("queue".into())
        )
        .await,
        Err(AppError::QueueRecoveryUncertain)
    ));
    assert!(matches!(
        select(
            &registry,
            &connection,
            "other-project",
            "task",
            Some("queue".into())
        )
        .await
        .unwrap(),
        Selection::Start(_, _)
    ));
    assert!(matches!(
        select(
            &registry,
            &connection,
            "project",
            "other-task",
            Some("queue".into())
        )
        .await
        .unwrap(),
        Selection::Start(_, _)
    ));
    drop(connection);
    server.await.unwrap();
}
