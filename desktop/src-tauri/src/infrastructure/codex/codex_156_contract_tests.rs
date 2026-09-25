use serde_json::{json, to_value};

use super::{conversation::map_item, protocol::IGNORED_NOTIFICATION_METHODS};

#[test]
fn file_id_image_history_should_degrade_without_exposing_an_unusable_asset_path() {
    let item = map_item(json!({
        "id": "message-a",
        "type": "userMessage",
        "content": [{"type": "image", "fileId": "file_123", "detail": "high"}],
    }))
    .expect("0.156 file-backed image history should remain readable");
    let item = to_value(item).unwrap();

    assert_eq!(item["text"], "[图片]");
    assert!(item.get("attachments").is_none());
    assert!(!item.to_string().contains("file_123"));
}

#[test]
fn unused_thread_attachment_notifications_should_be_disabled() {
    assert!(IGNORED_NOTIFICATION_METHODS.contains(&"thread/attachment/updated"));
}
