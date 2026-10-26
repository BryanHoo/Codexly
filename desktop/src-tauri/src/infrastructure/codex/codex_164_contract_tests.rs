use serde_json::{Value, json};

use super::{conversation::map_item, generated_image_store::GeneratedImageStore};

fn file_image() -> Value {
    json!({
        "id": "image-a", "type": "imageGeneration", "status": "completed",
        "failure": null, "fileId": "private-file-id", "revisedPrompt": null,
        "inputImages": [{"path": "/private/reference.png", "sha256": "ab".repeat(32)}],
    })
}

#[test]
fn file_reference_should_map_to_placeholder_without_leaking_metadata() {
    let item = serde_json::to_value(map_item(file_image()).unwrap()).unwrap();
    assert_eq!(item["type"], "message");
    assert_eq!(item["text"], "[图片]");
    assert!(!item.to_string().contains("private"));
}

#[test]
fn migration_file_reference_should_not_decode_stale_inline_result() {
    let directory = tempfile::tempdir().unwrap();
    let store = GeneratedImageStore::new(directory.path());
    for saved_path in [None, Some("/missing/codexly-generated-image.png")] {
        let mut item = file_image();
        item["result"] = json!("iVBORw0KGgo=");
        if let Some(path) = saved_path {
            item["savedPath"] = json!(path);
        }
        let sanitized = store
            .sanitize_frame(serde_json::to_vec(&item).unwrap())
            .unwrap();
        let item: Value = serde_json::from_slice(&sanitized).unwrap();
        assert!(item.get("codeagentAttachment").is_none());
        assert_eq!(item["result"], Value::Null);
    }
}

#[test]
fn file_reference_should_keep_valid_saved_image_and_bounded_metadata() {
    let directory = tempfile::tempdir().unwrap();
    let saved_path = directory.path().join("generated.png");
    std::fs::write(&saved_path, b"\x89PNG\r\n\x1a\n").unwrap();
    let store = GeneratedImageStore::new(directory.path());
    let mut item = file_image();
    item["savedPath"] = json!(saved_path);
    let sanitized = store
        .sanitize_frame(serde_json::to_vec(&item).unwrap())
        .unwrap();
    let item = map_item(serde_json::from_slice(&sanitized).unwrap()).unwrap();
    let item = serde_json::to_value(item).unwrap();
    assert_eq!(item["type"], "message");
    assert_eq!(item["attachments"][0]["size"], 8);
    assert!(!item.to_string().contains("private"));
}

#[test]
fn unfinished_file_reference_should_keep_tool_lifecycle() {
    for status in ["inProgress", "failed"] {
        let mut item = file_image();
        item["status"] = json!(status);
        let item = serde_json::to_value(map_item(item).unwrap()).unwrap();
        assert_eq!(item["type"], "tool");
    }
}
