// 提交幂等与跨连接竞争测试独立成模块，避免主目录实现混入大段测试逻辑。
use super::*;
#[tokio::test]
async fn acp_submission_should_retry_only_after_explicit_release_and_keep_identity() {
    let root = tempfile::tempdir().unwrap();
    let store = LocalCatalog::at(root.path()).unwrap();
    let request = json!({"projectId":"temporary","taskId":"t","key":"retry","fingerprint":"first"});
    assert_eq!(
        store
            .call("acp.submission.read", request.clone())
            .await
            .unwrap()["status"],
        "available"
    );
    store
        .call("acp.submission.begin", request.clone())
        .await
        .unwrap();
    store
        .call("acp.submission.retry", request.clone())
        .await
        .unwrap();
    let mut changed_retry = request.clone();
    changed_retry["fingerprint"] = json!("different-input");
    assert_eq!(
        store
            .call("acp.submission.read", changed_retry)
            .await
            .unwrap()["status"],
        "conflict"
    );
    assert_eq!(
        store
            .call("acp.submission.begin", request.clone())
            .await
            .unwrap()["status"],
        "reserved"
    );
    let mut changed = request.clone();
    changed["taskId"] = json!("other");
    assert_eq!(
        store.call("acp.submission.retry", changed).await.unwrap()["status"],
        "conflict"
    );
    assert_eq!(
        store.call("acp.submission.read", request).await.unwrap()["status"],
        "unknown"
    );
}

#[tokio::test]
async fn acp_submission_should_reserve_once_across_sqlite_connections() {
    let root = tempfile::tempdir().unwrap();
    LocalCatalog::at(root.path())
        .unwrap()
        .call("task.read", json!({"id":"initialise"}))
        .await
        .unwrap();
    let gate = Arc::new(std::sync::Barrier::new(2));
    let workers: Vec<_> = (0..2).map(|_| {
        let path = root.path().join("state.sqlite3");
        let gate = Arc::clone(&gate);
        std::thread::spawn(move || {
            let mut db = Connection::open(path).unwrap();
            db.busy_timeout(std::time::Duration::from_secs(5)).unwrap();
            gate.wait();
            super::acp_submissions::execute(&mut db,"acp.submission.begin",&json!({"projectId":"temporary","taskId":"t","key":"once","fingerprint":"same"})).unwrap()["status"].as_str().unwrap().to_owned()
        })
    }).collect();
    let mut outcomes: Vec<_> = workers
        .into_iter()
        .map(|worker| worker.join().unwrap())
        .collect();
    outcomes.sort();
    assert_eq!(outcomes, vec!["reserved", "unknown"]);
}

#[tokio::test]
async fn acp_submission_should_preserve_unknown_and_completed_results_across_reopen() {
    let root = tempfile::tempdir().unwrap();
    let store = LocalCatalog::at(root.path()).unwrap();
    let request = json!({"projectId":"temporary","taskId":"t","key":"once","fingerprint":"first"});
    let first = store
        .call("acp.submission.begin", request.clone())
        .await
        .unwrap();
    assert_eq!(first["status"], "reserved");
    drop(store);
    let store = LocalCatalog::at(root.path()).unwrap();
    assert_eq!(
        store
            .call("acp.submission.begin", request.clone())
            .await
            .unwrap()["status"],
        "unknown"
    );
    let mut conflict = request.clone();
    conflict["fingerprint"] = json!("changed");
    assert_eq!(
        store.call("acp.submission.begin", conflict).await.unwrap()["status"],
        "conflict"
    );
    let mut completed = request.clone();
    completed["result"] = json!({"id":"turn-one"});
    store
        .call("acp.submission.complete", completed)
        .await
        .unwrap();
    drop(store);
    let store = LocalCatalog::at(root.path()).unwrap();
    let replay = store.call("acp.submission.begin", request).await.unwrap();
    assert_eq!(
        replay,
        json!({"status":"completed","result":{"id":"turn-one"}})
    );
}
