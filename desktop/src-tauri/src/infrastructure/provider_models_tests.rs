use std::{
    fs,
    sync::atomic::{AtomicU64, Ordering},
};

use serde_json::json;

use super::provider_models::{read_provider_models, write_provider_models};

static TEST_ROOT_ID: AtomicU64 = AtomicU64::new(1);

fn test_root() -> std::path::PathBuf {
    let id = TEST_ROOT_ID.fetch_add(1, Ordering::Relaxed);
    std::env::temp_dir().join(format!(
        "codeagent-provider-models-{}-{id}",
        std::process::id()
    ))
}

#[tokio::test]
async fn provider_models_should_restore_only_for_the_matching_endpoint() {
    let root = test_root();
    let models = json!({
        "data": [{"displayName": "Custom A", "id": "custom-a"}],
        "nextCursor": null,
    });

    write_provider_models(&root, "relay", "https://api.example/v1", &models)
        .await
        .unwrap();

    assert_eq!(
        read_provider_models(&root, "relay", "https://api.example/v1")
            .await
            .unwrap(),
        Some(models)
    );
    assert_eq!(
        read_provider_models(&root, "other", "https://api.example/v1")
            .await
            .unwrap(),
        None
    );
    assert_eq!(
        read_provider_models(&root, "relay", "https://other.example/v1")
            .await
            .unwrap(),
        None
    );
    assert!(root.join("providers/codex/custom-models.json").is_file());

    fs::remove_dir_all(root).unwrap();
}
