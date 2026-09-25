use std::collections::BTreeMap;

use super::app_storage_runtime::PreferenceWriteBuffer;

#[tokio::test]
async fn shutdown_should_wait_for_failed_writes_to_recover() {
    use std::time::Duration;
    let root = std::env::temp_dir().join(format!(
        "storage-retry-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&root).unwrap();
    // 用同名目录稳定制造原子替换失败，恢复后必须写回保留的草稿。
    std::fs::create_dir(root.join("app.json")).unwrap();
    let runtime = super::app_storage_runtime::AppStorageRuntime::default();
    runtime
        .enqueue(
            root.clone(),
            BTreeMap::from([("codeagent.draft".into(), Some("unsaved".into()))]),
        )
        .await
        .unwrap();
    assert!(
        tokio::time::timeout(Duration::from_millis(150), runtime.shutdown())
            .await
            .is_err()
    );
    assert!(
        runtime
            .enqueue(root.clone(), BTreeMap::new())
            .await
            .is_err()
    );
    std::fs::remove_dir(root.join("app.json")).unwrap();
    // 取消一个等待者不能取消 writer；多个关闭调用必须等待同一个完成信号。
    tokio::time::timeout(Duration::from_secs(5), async {
        let (first, second) = tokio::join!(runtime.shutdown(), runtime.shutdown());
        first.unwrap();
        second.unwrap();
    })
    .await
    .unwrap();
    let stored = crate::infrastructure::app_storage::read_preferences(&root)
        .await
        .unwrap();
    assert_eq!(
        stored.get("codeagent.draft").map(String::as_str),
        Some("unsaved")
    );
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn shutdown_before_first_write_should_reject_initialization() {
    let runtime = super::app_storage_runtime::AppStorageRuntime::default();
    runtime.shutdown().await.unwrap();
    assert!(
        runtime
            .enqueue(std::path::PathBuf::new(), BTreeMap::new())
            .await
            .is_err()
    );
}

#[tokio::test]
async fn shutdown_should_persist_accepted_updates_and_reject_new_writes() {
    let root = std::env::temp_dir().join(format!(
        "storage-shutdown-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let runtime = super::app_storage_runtime::AppStorageRuntime::default();
    runtime
        .enqueue(
            root.clone(),
            BTreeMap::from([
                ("codeagent.theme".into(), Some("dark".into())),
                ("codeagent.draft".into(), Some("latest draft".into())),
            ]),
        )
        .await
        .unwrap();
    runtime.shutdown().await.unwrap();
    let stored = crate::infrastructure::app_storage::read_preferences(&root)
        .await
        .unwrap();
    assert_eq!(
        stored.get("codeagent.draft").map(String::as_str),
        Some("latest draft")
    );
    assert_eq!(
        stored.get("codeagent.theme").map(String::as_str),
        Some("dark")
    );
    assert!(
        runtime
            .enqueue(root.clone(), BTreeMap::new())
            .await
            .is_err()
    );
    runtime.shutdown().await.unwrap();
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn preference_write_buffer_should_merge_updates_with_latest_value() {
    let mut buffer = PreferenceWriteBuffer::default();
    buffer.merge(BTreeMap::from([
        ("codeagent.language".to_owned(), Some("zh-CN".to_owned())),
        ("codeagent.theme".to_owned(), Some("light".to_owned())),
    ]));
    buffer.merge(BTreeMap::from([
        ("codeagent.language".to_owned(), Some("en".to_owned())),
        ("codeagent.theme".to_owned(), None),
    ]));

    assert_eq!(
        buffer.take(),
        BTreeMap::from([
            ("codeagent.language".to_owned(), Some("en".to_owned())),
            ("codeagent.theme".to_owned(), None),
        ])
    );
    assert!(buffer.is_empty());
}

#[test]
fn failed_preference_write_should_be_restored_without_overwriting_newer_updates() {
    let mut buffer = PreferenceWriteBuffer::default();
    buffer.merge(BTreeMap::from([(
        "codeagent.draft".to_owned(),
        Some("new".to_owned()),
    )]));
    buffer.restore_failed(BTreeMap::from([
        ("codeagent.draft".to_owned(), Some("old".to_owned())),
        ("codeagent.theme".to_owned(), Some("dark".to_owned())),
    ]));

    assert_eq!(
        buffer.take(),
        BTreeMap::from([
            ("codeagent.draft".to_owned(), Some("new".to_owned()),),
            ("codeagent.theme".to_owned(), Some("dark".to_owned()),),
        ])
    );
}
