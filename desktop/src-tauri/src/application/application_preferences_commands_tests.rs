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
    global["defaultOpenAppId"] = json!("iterm2");
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

#[tokio::test]
async fn application_preferences_startup_should_import_legacy_instructions_once_after_read_error() {
    let directory = tempfile::tempdir().unwrap();
    let home = tempfile::tempdir().unwrap();
    let claude = home.path().join(".claude");
    let codex = home.path().join("custom-codex");
    tokio::fs::create_dir_all(&claude).await.unwrap();
    tokio::fs::create_dir_all(&codex).await.unwrap();
    let claude_file = claude.join("CLAUDE.md");
    let codex_file = codex.join("AGENTS.md");
    let body = "Claude 的全局指令\r\n  ";
    tokio::fs::write(&claude_file, body).await.unwrap();
    tokio::fs::write(&codex_file, [0xff]).await.unwrap();
    let migrate = || {
        import_legacy_instructions(directory.path(), home.path(), |key| {
            (key == "CODEX_HOME").then(|| codex.clone())
        })
    };
    assert!(migrate().await.is_err());
    assert!(
        deliver(directory.path(), json!({"type":"read"}))
            .await
            .unwrap()
            .get("globalInstructions")
            .is_none()
    );

    tokio::fs::remove_file(&codex_file).await.unwrap();
    migrate().await.unwrap();
    assert_eq!(
        deliver(directory.path(), json!({"type":"read"}))
            .await
            .unwrap()["globalInstructions"],
        body
    );
    assert_eq!(tokio::fs::read_to_string(&claude_file).await.unwrap(), body);

    deliver(
        directory.path(),
        json!({"type":"patch","changes":{"globalInstructions":""}}),
    )
    .await
    .unwrap();
    migrate().await.unwrap();
    assert_eq!(
        deliver(directory.path(), json!({"type":"read"}))
            .await
            .unwrap()["globalInstructions"],
        ""
    );
}

#[tokio::test]
async fn application_preferences_startup_should_select_codex_before_claude() {
    let directory = tempfile::tempdir().unwrap();
    let home = tempfile::tempdir().unwrap();
    let claude = home.path().join(".claude");
    let codex = home.path().join(".codex");
    tokio::fs::create_dir_all(&claude).await.unwrap();
    tokio::fs::create_dir_all(&codex).await.unwrap();
    tokio::fs::write(claude.join("CLAUDE.md"), [0xff])
        .await
        .unwrap();
    tokio::fs::write(codex.join("AGENTS.md"), "Codex 普通指令")
        .await
        .unwrap();
    let override_file = codex.join("AGENTS.override.md");
    let expected = "Codex 覆盖指令\r\n";
    tokio::fs::write(&override_file, expected).await.unwrap();

    let migrate = || import_legacy_instructions(directory.path(), home.path(), |_| None);
    migrate().await.unwrap();
    tokio::fs::write(override_file, "后续修改").await.unwrap();
    migrate().await.unwrap();
    assert_eq!(
        deliver(directory.path(), json!({"type":"read"}))
            .await
            .unwrap()["globalInstructions"],
        expected
    );
}
