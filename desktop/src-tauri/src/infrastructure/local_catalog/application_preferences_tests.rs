use super::*;

fn baseline() -> Value {
    let source: Value = serde_json::from_str(include_str!(
        "../../../../../packages/protocol/src/application-preferences-sql.json"
    ))
    .unwrap();
    source["defaults"].clone()
}

#[test]
fn application_preferences_should_merge_cross_connection_patches_and_preserve_null() {
    let dir = tempfile::tempdir().unwrap();
    let store = LocalCatalog::at(dir.path()).unwrap();
    assert!(
        store
            .execute("app.preferences.read", &json!({}))
            .unwrap()
            .is_null()
    );
    let gate = Arc::new(std::sync::Barrier::new(2));
    let workers: Vec<_> = [
        json!({"taskTitlePrompt":"标题"}),
        json!({"followUpBehavior":"steer"}),
    ]
    .into_iter()
    .map(|changes| {
        let path = dir.path().join("state.sqlite3");
        let gate = Arc::clone(&gate);
        std::thread::spawn(move || {
            let mut db = Connection::open(path).unwrap();
            db.busy_timeout(std::time::Duration::from_secs(5)).unwrap();
            gate.wait();
            operations::execute(
                &mut db,
                "app.preferences.patch",
                &json!({"baseline":baseline(),"changes":changes}),
            )
            .unwrap()
        })
    })
    .collect();
    for worker in workers {
        worker.join().unwrap();
    }
    drop(store);
    let store = LocalCatalog::at(dir.path()).unwrap();
    let actual = store.execute("app.preferences.read", &json!({})).unwrap();
    assert_eq!(actual["taskTitlePrompt"], "标题");
    assert_eq!(actual["followUpBehavior"], "steer");
    assert!(actual["defaultModel"].is_null());
    let actual=store.execute("app.preferences.patch",&json!({"baseline":baseline(),"changes":{"defaultAgent":"claude","defaultModel":"raw/model"}})).unwrap();
    assert_eq!(actual["taskTitlePrompt"], "标题");
    assert_eq!(actual["defaultModel"], "raw/model");
}

#[test]
fn application_preferences_should_reject_invalid_patches_without_snapshot() {
    let dir = tempfile::tempdir().unwrap();
    let store = LocalCatalog::at(dir.path()).unwrap();
    for changes in [
        json!({}),
        json!({"model":"x"}),
        json!({"defaultModel":null}),
        json!({"defaultAgent":"codex"}),
        json!({"pet":{"enabled":true,"selectedPetId":null}}),
        json!({"taskTitlePrompt":"长".repeat(4001)}),
    ] {
        assert!(
            store
                .execute(
                    "app.preferences.patch",
                    &json!({"baseline":baseline(),"changes":changes})
                )
                .is_err()
        );
    }
    assert!(
        store
            .execute("app.preferences.read", &json!({}))
            .unwrap()
            .is_null()
    );
}

#[test]
fn application_preferences_should_fail_on_damaged_snapshot_without_replacement() {
    let dir = tempfile::tempdir().unwrap();
    let store = LocalCatalog::at(dir.path()).unwrap();
    store
        .execute(
            "app.preferences.patch",
            &json!({"baseline":baseline(),"changes":{"taskTitlePrompt":"标题"}}),
        )
        .unwrap();
    let db = Connection::open(dir.path().join("state.sqlite3")).unwrap();
    db.execute(
        "UPDATE acp_application_preferences SET settings_json='{}' WHERE id=1",
        [],
    )
    .unwrap();
    assert!(store.execute("app.preferences.read", &json!({})).is_err());
    assert!(
        store
            .execute(
                "app.preferences.patch",
                &json!({"baseline":baseline(),"changes":{"taskTitlePrompt":"不能覆盖"}})
            )
            .is_err()
    );
    assert_eq!(
        db.query_row(
            "SELECT settings_json FROM acp_application_preferences",
            [],
            |r| r.get::<_, String>(0)
        )
        .unwrap(),
        "{}"
    );
}
