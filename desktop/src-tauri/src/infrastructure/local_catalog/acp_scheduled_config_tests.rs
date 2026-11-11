use super::*;

#[tokio::test]
async fn acp_scheduled_config_should_preserve_revision_and_source() {
    let root = tempfile::tempdir().unwrap();
    let store = LocalCatalog::at(root.path()).unwrap();
    let key = json!({"source":"web","scheduleId":"same-plan"});
    assert_eq!(
        store.call("acp.schedule.read", key.clone()).await.unwrap(),
        Value::Null
    );
    let request = json!({"source":"web","scheduleId":"same-plan","engine":"claude","values":{"mode":false,"nativeModel":"raw"},"expectedRevision":0});
    assert_eq!(
        store
            .call("acp.schedule.set", request.clone())
            .await
            .unwrap()["revision"],
        1
    );
    assert_eq!(
        store
            .call("acp.schedule.set", request.clone())
            .await
            .unwrap(),
        Value::Null
    );
    let mut changed = request.clone();
    changed["expectedRevision"] = json!(1);
    changed["values"] = json!({"mode":true});
    assert_eq!(
        store
            .call("acp.schedule.set", changed.clone())
            .await
            .unwrap()["revision"],
        2
    );
    assert_eq!(
        store.call("acp.schedule.set", changed).await.unwrap(),
        Value::Null
    );
    let mut desktop = request;
    desktop["source"] = json!("desktop");
    assert_eq!(
        store.call("acp.schedule.set", desktop).await.unwrap()["revision"],
        1
    );
    assert!(
        !store
            .call(
                "acp.schedule.delete",
                json!({"source":"web","scheduleId":"same-plan","expectedRevision":1})
            )
            .await
            .unwrap()
            .as_bool()
            .unwrap()
    );
    drop(store);
    let reopened = LocalCatalog::at(root.path()).unwrap();
    assert_eq!(
        reopened.call("acp.schedule.read", key).await.unwrap()["values"]["mode"],
        true
    );
    assert!(
        reopened
            .call(
                "acp.schedule.delete",
                json!({"source":"web","scheduleId":"same-plan","expectedRevision":2})
            )
            .await
            .unwrap()
            .as_bool()
            .unwrap()
    );
    assert_eq!(
        reopened
            .call(
                "acp.schedule.read",
                json!({"source":"desktop","scheduleId":"same-plan"})
            )
            .await
            .unwrap()["revision"],
        1
    );
}

#[tokio::test]
async fn acp_scheduled_config_should_reject_invalid_values_and_preserve_old_files() {
    let root = tempfile::tempdir().unwrap();
    let old = root.path().join("scheduled-tasks.json");
    let bytes = br#"{"schemaVersion":1,"tasks":[]}"#;
    std::fs::write(&old, bytes).unwrap();
    let store = LocalCatalog::at(root.path()).unwrap();
    let request = json!({"source":"web","scheduleId":"plan","engine":"codex","values":{},"expectedRevision":0});
    store
        .call("acp.schedule.set", request.clone())
        .await
        .unwrap();
    for values in [
        json!({"bad":{}}),
        json!({ ("😀".repeat(129)):true }),
        json!({"long":"x".repeat(16385)}),
    ] {
        let mut changed = request.clone();
        changed["expectedRevision"] = json!(1);
        changed["values"] = values;
        assert!(store.call("acp.schedule.set", changed).await.is_err());
    }
    assert_eq!(std::fs::read(old).unwrap(), bytes);
    assert_eq!(
        store
            .call(
                "acp.schedule.read",
                json!({"source":"web","scheduleId":"plan"})
            )
            .await
            .unwrap()["revision"],
        1
    );
}

#[tokio::test]
async fn acp_scheduled_config_should_accept_only_one_concurrent_revision() {
    let root = tempfile::tempdir().unwrap();
    let store = LocalCatalog::at(root.path()).unwrap();
    let request = json!({"source":"desktop","scheduleId":"race","engine":"codex","values":{},"expectedRevision":0});
    store
        .call("acp.schedule.set", request.clone())
        .await
        .unwrap();
    // 使用独立 SQLite 连接竞争，避免共享进程内 Mutex 掩盖 CAS 缺陷。
    let gate = Arc::new(std::sync::Barrier::new(2));
    let workers: Vec<_> = (0..2)
        .map(|_| {
            let path = root.path().join("state.sqlite3");
            let gate = Arc::clone(&gate);
            let mut request = request.clone();
            request["expectedRevision"] = json!(1);
            std::thread::spawn(move || {
                let mut db = Connection::open(path).unwrap();
                db.busy_timeout(std::time::Duration::from_secs(5)).unwrap();
                gate.wait();
                operations::execute(&mut db, "acp.schedule.set", &request).unwrap()
            })
        })
        .collect();
    assert_eq!(
        workers
            .into_iter()
            .map(|worker| worker.join().unwrap())
            .filter(|value| !value.is_null())
            .count(),
        1
    );
    assert_eq!(
        store
            .call(
                "acp.schedule.read",
                json!({"source":"desktop","scheduleId":"race"})
            )
            .await
            .unwrap()["revision"],
        2
    );
}

#[tokio::test]
async fn acp_scheduled_config_should_enforce_capacity_and_reject_corrupt_storage() {
    let root = tempfile::tempdir().unwrap();
    let store = LocalCatalog::at(root.path()).unwrap();
    let request = json!({"source":"desktop","scheduleId":"plan","engine":"codex","values":{},"expectedRevision":0});
    store
        .call("acp.schedule.read", request.clone())
        .await
        .unwrap();
    let mut db = Connection::open(root.path().join("state.sqlite3")).unwrap();
    let oversized: serde_json::Map<String, Value> = (0..17)
        .map(|index| (index.to_string(), json!("x".repeat(16384))))
        .collect();
    let mut changed = request.clone();
    changed["values"] = json!(oversized);
    assert!(store.call("acp.schedule.set", changed).await.is_err());
    let tx = db.transaction().unwrap();
    for index in 0..1000 {
        tx.execute(
            "INSERT INTO acp_scheduled_configs VALUES ('desktop',?,'codex','{}',1)",
            [index.to_string()],
        )
        .unwrap();
    }
    tx.commit().unwrap();
    assert!(
        store
            .call("acp.schedule.set", request.clone())
            .await
            .is_err()
    );
    let mut changed = request.clone();
    changed["scheduleId"] = json!("0");
    changed["expectedRevision"] = json!(1);
    assert_eq!(
        store.call("acp.schedule.set", changed).await.unwrap()["revision"],
        2
    );
    db.execute_batch("DELETE FROM acp_scheduled_configs")
        .unwrap();
    let large: serde_json::Map<String, Value> = (0..16)
        .map(|index| (index.to_string(), json!("x".repeat(16000))))
        .collect();
    let encoded = serde_json::to_string(&large).unwrap();
    let tx = db.transaction().unwrap();
    for index in 0..65 {
        tx.execute(
            "INSERT INTO acp_scheduled_configs VALUES ('desktop',?,'codex',?,1)",
            rusqlite::params![index.to_string(), encoded],
        )
        .unwrap();
    }
    tx.commit().unwrap();
    let mut changed = request.clone();
    changed["values"] = json!(large);
    assert!(store.call("acp.schedule.set", changed).await.is_err());
    // 数据库约束只保证 JSON 对象；读取边界仍需拒绝非法 ACP 值，不能降级默认配置。
    db.execute(
        "UPDATE acp_scheduled_configs SET values_json=? WHERE schedule_id='0'",
        [r#"{"bad":{}}"#],
    )
    .unwrap();
    assert!(
        store
            .call(
                "acp.schedule.read",
                json!({"source":"desktop","scheduleId":"0"})
            )
            .await
            .is_err()
    );
}
