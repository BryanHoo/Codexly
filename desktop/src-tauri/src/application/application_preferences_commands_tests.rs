use super::*;

#[tokio::test]
async fn application_preferences_delivery_should_preserve_old_bytes_and_survive_source_damage() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("agent-settings.json");
    let empty = deliver(directory.path(), json!({"type":"read"}))
        .await
        .unwrap();
    assert!(empty["defaultModel"].is_null());
    assert!(!path.exists());
    let mut global = empty.clone();
    global["defaultModel"] = json!("old-model");
    let bytes =
        serde_json::to_vec_pretty(&json!({"version":1,"projects":{},"global":global})).unwrap();
    tokio::fs::write(&path, &bytes).await.unwrap();
    let old = crate::infrastructure::local_settings::read_global_settings(directory.path())
        .await
        .unwrap();
    assert_eq!(
        deliver(directory.path(), json!({"type":"read"}))
            .await
            .unwrap(),
        global
    );
    let updated=deliver(directory.path(),json!({"type":"patch","changes":{"defaultAgent":"claude","defaultModel":"新原始模型/😀".repeat(1000)}})).await.unwrap();
    assert_eq!(tokio::fs::read(&path).await.unwrap(), bytes);
    assert_eq!(
        crate::infrastructure::local_settings::read_global_settings(directory.path())
            .await
            .unwrap(),
        old
    );
    tokio::fs::write(&path, b"broken old settings")
        .await
        .unwrap();
    assert_eq!(
        deliver(directory.path(), json!({"type":"read"}))
            .await
            .unwrap(),
        updated
    );
    let next = deliver(
        directory.path(),
        json!({"type":"patch","changes":{"defaultAgent":"codex","defaultModel":null}}),
    )
    .await
    .unwrap();
    assert!(next["defaultModel"].is_null());
}

#[tokio::test]
async fn application_preferences_delivery_should_reject_injection_and_allow_source_retry() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("agent-settings.json");
    tokio::fs::write(&path, b"invalid").await.unwrap();
    assert!(
        deliver(directory.path(), json!({"type":"read"}))
            .await
            .is_err()
    );
    let store = LocalCatalog::at(directory.path()).unwrap();
    assert!(
        store
            .call("app.preferences.read", json!({}))
            .await
            .unwrap()
            .is_null()
    );
    tokio::fs::remove_file(&path).await.unwrap();
    assert!(
        deliver(directory.path(), json!({"type":"read"}))
            .await
            .unwrap()["defaultModel"]
            .is_null()
    );
    for input in [
        json!({"type":"read","cwd":"/secret"}),
        json!({"type":"patch","changes":{"defaultModel":null}}),
        json!({"type":"patch","changes":{"model":"x"}}),
        json!({"type":"patch","baseline":{},"changes":{"taskTitlePrompt":"x"}}),
    ] {
        assert!(deliver(directory.path(), input).await.is_err());
    }
    assert!(
        store
            .call("app.preferences.read", json!({}))
            .await
            .unwrap()
            .is_null()
    );
}
