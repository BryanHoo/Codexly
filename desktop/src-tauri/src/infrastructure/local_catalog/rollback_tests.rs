use super::*;

#[tokio::test]
async fn acp_journal_should_keep_released_catalog_schema_and_old_sql_writes_usable() {
    let fixture: Value = serde_json::from_str(include_str!(
        "../../../../../tests/fixtures/acp-rollback-v0.53.0.json"
    ))
    .unwrap();
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("state.sqlite3");
    let old = Connection::open(&path).unwrap();
    old.execute_batch(fixture["catalog"]["sql"].as_str().unwrap())
        .unwrap();
    old.execute_batch("PRAGMA user_version=27;").unwrap();
    let settings = json!({"version":1,"global":{"defaultAgent":"codex","defaultModel":"legacy-model","commitMessagePrompt":"旧提交规则","taskTitlePrompt":"旧标题规则","promptOptimizationPrompt":"","defaultOpenAppId":null,"followUpBehavior":"queue","pet":{"enabled":false,"selectedPetId":"codex"}},"projects":{}});
    let settings_bytes = serde_json::to_vec_pretty(&settings).unwrap();
    std::fs::write(root.path().join("agent-settings.json"), &settings_bytes).unwrap();
    old.execute("INSERT INTO managed_tasks VALUES ('legacy',NULL,'旧任务','/old-workspace','codex','native-session',1,0,0,'idle')",[]).unwrap();
    let store = LocalCatalog::at(root.path()).unwrap();
    assert_eq!(
        store
            .call("task.read", json!({"id":"legacy"}))
            .await
            .unwrap()["sessionId"],
        "native-session"
    );
    let request = json!({"projectId":"temporary","taskId":"legacy","key":"new-attempt","fingerprint":"acp-body-hash"});
    store.call("acp.submission.begin", request).await.unwrap();
    // 私有计划配置已写入后，旧目录读取和不带列名的 SQL 写入也必须继续工作。
    store.call("acp.schedule.set", json!({"source":"desktop","scheduleId":"legacy-plan","engine":"claude","values":{"agent-defined-mode":true,"model":"native-model"},"expectedRevision":0})).await.unwrap();
    drop(store);
    let acp_settings = root.path().join("engines/acp/settings");
    std::fs::create_dir_all(&acp_settings).unwrap();
    std::fs::write(
        acp_settings.join("claude.json"),
        r#"{"version":1,"configured":true,"values":{"new-mode":true}}"#,
    )
    .unwrap();
    assert_eq!(
        std::fs::read(root.path().join("agent-settings.json")).unwrap(),
        settings_bytes
    );
    // 读取器沿用迁移前的原生本地偏好契约，ACP 自有目录中的新枚举不会进入旧记录。
    let legacy_settings = crate::infrastructure::local_settings::read_global_settings(root.path())
        .await
        .unwrap();
    assert_eq!(legacy_settings["defaultModel"], "legacy-model");
    assert_eq!(legacy_settings["followUpBehavior"], "queue");
    // 模拟旧进程重新打开同库；旧 INSERT VALUES 不带列名，列数变化也会直接暴露。
    let old = Connection::open(&path).unwrap();
    assert_eq!(
        old.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        27
    );
    assert_eq!(
        old.query_row(
            "SELECT session_id FROM managed_tasks WHERE id='legacy'",
            [],
            |r| r.get::<_, String>(0)
        )
        .unwrap(),
        "native-session"
    );
    old.execute("INSERT INTO managed_tasks VALUES ('old-created',NULL,'旧版继续使用','/old-workspace','claude',NULL,2,0,0,'idle')",[]).unwrap();
    old.execute(
        "UPDATE managed_tasks SET title='旧版更新' WHERE id='legacy'",
        [],
    )
    .unwrap();
    assert_eq!(
        old.query_row(
            "SELECT title FROM managed_tasks WHERE id='legacy'",
            [],
            |r| r.get::<_, String>(0)
        )
        .unwrap(),
        "旧版更新"
    );
}
