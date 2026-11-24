use super::*;
use std::{cell::RefCell, sync::mpsc, time::Duration};
thread_local! {static WAITING:RefCell<Option<mpsc::Sender<()>>> = const {RefCell::new(None)};}
fn sample(id: &str) -> Value {
    json!({"id":id,"provider":"claude","projectId":null,"title":"","cwd":"/workspace","sessionId":null,"updatedAt":1,"pinned":false,"archived":false,"status":"idle"})
}
#[tokio::test]
async fn acp_title_should_claim_once_and_keep_manual_names() {
    let root = tempfile::tempdir().unwrap();
    let store = LocalCatalog::at(root.path()).unwrap();
    store.call("task.put", sample("new")).await.unwrap();
    let claim = json!({"id":"new","token":"one","engine":"claude","projectId":null});
    assert_eq!(
        store.call("acp.title.claim", claim.clone()).await.unwrap(),
        true
    );
    assert_eq!(store.call("acp.title.claim", claim).await.unwrap(), false);
    store
        .call("task.patch", json!({"id":"new","title":"手动名称"}))
        .await
        .unwrap();
    assert_eq!(
        store
            .call(
                "acp.title.finish",
                json!({"id":"new","token":"one","title":"自动名称"})
            )
            .await
            .unwrap(),
        Value::Null
    );
    assert_eq!(
        store.call("task.read", json!({"id":"new"})).await.unwrap()["title"],
        "手动名称"
    );
    store.call("task.put", sample("auto")).await.unwrap();
    assert_eq!(
        store
            .call(
                "acp.title.claim",
                json!({"id":"auto","token":"one","engine":"claude","projectId":null})
            )
            .await
            .unwrap(),
        true
    );
    store
        .call("task.patch", json!({"id":"auto","status":"active"}))
        .await
        .unwrap();
    assert_eq!(
        store
            .call(
                "acp.title.finish",
                json!({"id":"auto","token":"one","title":"自动名称"})
            )
            .await
            .unwrap(),
        "自动名称"
    );
}
#[tokio::test]
async fn task_status_patch_should_not_erase_a_concurrent_title_commit() {
    let root = tempfile::tempdir().unwrap();
    let store = LocalCatalog::at(root.path()).unwrap();
    store.call("task.put", sample("race")).await.unwrap();
    let path = root.path().join("state.sqlite3");
    let mut writer = Connection::open(&path).unwrap();
    let transaction = writer
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .unwrap();
    transaction
        .execute(
            "UPDATE managed_tasks SET title='手动名称' WHERE id='race'",
            [],
        )
        .unwrap();
    let (sender, receiver) = mpsc::channel();
    let worker = std::thread::spawn(move || {
        WAITING.with(|slot| *slot.borrow_mut() = Some(sender));
        let mut db = Connection::open(path).unwrap();
        db.busy_handler(Some(|_| {
            WAITING.with(|slot| {
                if let Some(sender) = slot.borrow_mut().take() {
                    let _ = sender.send(());
                }
            });
            std::thread::sleep(Duration::from_millis(1));
            true
        }))
        .unwrap();
        operations::execute(&mut db, "task.patch", &json!({"id":"race","status":"idle"})).unwrap()
    });
    // SQLite 已经等待写锁才释放另一个连接，固定旧整行补丁的读 / 写竞争顺序。
    let waiting = receiver.recv_timeout(Duration::from_secs(3));
    transaction.commit().unwrap();
    let result = worker.join().unwrap();
    assert!(waiting.is_ok());
    assert_eq!(result["title"], "手动名称");
}

#[tokio::test]
async fn acp_title_should_preserve_old_rows_and_consume_failed_or_archived_claims() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("state.sqlite3");
    let original = LocalCatalog::at(root.path()).unwrap();
    original.call("task.put", sample("old")).await.unwrap();
    drop(original);
    let db = Connection::open(&path).unwrap();
    db.execute_batch("DROP TRIGGER acp_task_titles_register; DROP TRIGGER acp_task_titles_invalidate; DROP TABLE acp_task_titles").unwrap();
    let version: i64 = db
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .unwrap();
    let schema: String = db
        .query_row(
            "SELECT sql FROM sqlite_master WHERE name='managed_tasks'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let store = LocalCatalog::at(root.path()).unwrap();
    assert_eq!(
        store
            .call(
                "acp.title.claim",
                json!({"id":"old","token":"one","engine":"claude","projectId":null})
            )
            .await
            .unwrap(),
        false
    );
    assert_eq!(
        db.pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
            .unwrap(),
        version
    );
    assert_eq!(
        db.query_row(
            "SELECT sql FROM sqlite_master WHERE name='managed_tasks'",
            [],
            |row| row.get::<_, String>(0)
        )
        .unwrap(),
        schema
    );
    for id in ["archive", "failure", "delete", "old-writer"] {
        store.call("task.put", sample(id)).await.unwrap();
        for (engine, project) in [("codex", Value::Null), ("claude", json!("wrong"))] {
            assert_eq!(
                store
                    .call(
                        "acp.title.claim",
                        json!({"id":id,"token":"one","engine":engine,"projectId":project})
                    )
                    .await
                    .unwrap(),
                false
            );
        }
        assert_eq!(
            store
                .call(
                    "acp.title.claim",
                    json!({"id":id,"token":"one","engine":"claude","projectId":null})
                )
                .await
                .unwrap(),
            true
        );
        assert_eq!(
            store
                .call(
                    "acp.title.finish",
                    json!({"id":id,"token":"wrong","title":"错误"})
                )
                .await
                .unwrap(),
            Value::Null
        );
    }
    store
        .call("task.patch", json!({"id":"archive","archived":true}))
        .await
        .unwrap();
    store
        .call("task.patch", json!({"id":"archive","archived":false}))
        .await
        .unwrap();
    store
        .call("task.remove", json!({"id":"delete"}))
        .await
        .unwrap();
    db.execute(
        "UPDATE managed_tasks SET title='旧版本名称' WHERE id='old-writer'",
        [],
    )
    .unwrap();
    for id in ["archive", "delete", "old-writer"] {
        assert_eq!(
            store
                .call(
                    "acp.title.finish",
                    json!({"id":id,"token":"one","title":"迟到标题"})
                )
                .await
                .unwrap(),
            Value::Null
        );
    }
    assert_eq!(
        store
            .call(
                "acp.title.finish",
                json!({"id":"failure","token":"one","title":null})
            )
            .await
            .unwrap(),
        Value::Null
    );
    drop(store);
    let restarted = LocalCatalog::at(root.path()).unwrap();
    for id in ["failure", "archive", "old-writer"] {
        assert_eq!(
            restarted
                .call(
                    "acp.title.claim",
                    json!({"id":id,"token":"retry","engine":"claude","projectId":null})
                )
                .await
                .unwrap(),
            false
        );
    }
}
