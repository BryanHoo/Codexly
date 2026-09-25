use super::*;

fn root(label: &str) -> PathBuf {
    std::env::temp_dir().join(format!(
        "codeagent-queue-{label}-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ))
}

#[test]
fn queued_media_should_reuse_cache_and_keep_tasks_isolated() {
    let root = root("isolation");
    let store = QueuedMediaStore::new(&root);
    let input =
        json!({"type":"image", "url":"data:image/png;base64,iVBORw0KGgo=", "detail":"high"});
    let first = store.restore("task-a", &input).unwrap();
    let modified = fs::metadata(first["id"].as_str().unwrap())
        .unwrap()
        .modified()
        .unwrap();
    assert_eq!(store.restore("task-a", &input).unwrap(), first);
    assert_eq!(
        fs::metadata(first["id"].as_str().unwrap())
            .unwrap()
            .modified()
            .unwrap(),
        modified
    );
    let second = store.restore("task-b", &input).unwrap();
    assert_ne!(first["id"], second["id"]);
    assert_eq!(first["detail"], "high");
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn queued_media_should_reject_remote_urls_and_invalid_snapshots_without_partial_files() {
    let root = root("invalid");
    let store = QueuedMediaStore::new(&root);
    for url in [
        "https://example.com/image.png",
        "data:image/svg+xml;base64,PHN2Zz4=",
        "data:image/png;base64,",
        "data:image/png;base64,aW52YWxpZA==",
        "data:image/png;base64,!!!",
    ] {
        assert!(
            store
                .restore("task-a", &json!({"type":"image", "url":url}))
                .is_err()
        );
    }
    let directory = root.join("attachments").join(scope("task-a"));
    assert_eq!(fs::read_dir(directory).unwrap().count(), 0);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn queued_audio_snapshot_should_restore_a_local_file() {
    let root = root("audio");
    let restored = QueuedMediaStore::new(&root)
        .restore(
            "task-a",
            &json!({
                "type":"audio", "url":"data:audio/mpeg;base64,SUQz"
            }),
        )
        .unwrap();
    assert_eq!(restored["kind"], "file");
    assert_eq!(restored["mediaType"], "audio/mpeg");
    assert_eq!(fs::read(restored["id"].as_str().unwrap()).unwrap(), b"ID3");
    fs::remove_dir_all(root).unwrap();
}
