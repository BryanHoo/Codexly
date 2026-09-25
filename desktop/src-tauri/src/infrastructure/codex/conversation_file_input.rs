use std::path::Path;

use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};

use super::connection::ConnectionError;

const FILE_PLACEHOLDER_PREFIX: &str = "codexly-file:";
const MAX_TEXT_BYTES: usize = 1024 * 1024;
const MAX_FILE_BYTES: usize = 50 * 1024 * 1024;

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct FileMetadata {
    kind: String,
    media_type: String,
    name: String,
    size: usize,
}

pub(super) fn create_file_text_input(attachment: &Value) -> Result<Value, ConnectionError> {
    let object = attachment
        .as_object()
        .ok_or(ConnectionError::InvalidMessage)?;
    let path = required_string(object, "id")?;
    let metadata = FileMetadata {
        kind: required_string(object, "kind")?.to_owned(),
        media_type: required_string(object, "mediaType")?.to_owned(),
        name: required_string(object, "name")?.to_owned(),
        size: required_size(object)?,
    };
    validate_metadata(&metadata)?;
    if !Path::new(path).is_absolute() {
        return Err(ConnectionError::InvalidMessage);
    }
    let encoded = URL_SAFE_NO_PAD.encode(serde_json::to_vec(&metadata)?);
    Ok(json!({
        "text": path,
        "text_elements": [{
            "byteRange": {"start": 0, "end": path.len()},
            "placeholder": format!("{FILE_PLACEHOLDER_PREFIX}{encoded}"),
        }],
        "type": "text",
    }))
}

pub(super) struct FileTextInput {
    pub text: String,
    pub attachments: Vec<Value>,
}

pub(super) fn read_file_text_input(
    object: &Map<String, Value>,
) -> Result<Option<FileTextInput>, ConnectionError> {
    let text = required_string(object, "text")?;
    // UserInput 字段为 text_elements，内部区间仍为 byteRange。
    let Some(elements) = object.get("text_elements").and_then(Value::as_array) else {
        return Ok(None);
    };
    let mut visible = String::new();
    let mut attachments = Vec::new();
    let mut cursor = 0;
    for element in elements {
        let Some(encoded) = element
            .get("placeholder")
            .and_then(Value::as_str)
            .and_then(|value| value.strip_prefix(FILE_PLACEHOLDER_PREFIX))
        else {
            continue;
        };
        let metadata: FileMetadata = URL_SAFE_NO_PAD
            .decode(encoded)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .ok_or(ConnectionError::InvalidMessage)?;
        validate_metadata(&metadata)?;
        let range = element
            .get("byteRange")
            .ok_or(ConnectionError::InvalidMessage)?;
        let start = range
            .get("start")
            .and_then(Value::as_u64)
            .and_then(|value| usize::try_from(value).ok())
            .ok_or(ConnectionError::InvalidMessage)?;
        let end = range
            .get("end")
            .and_then(Value::as_u64)
            .and_then(|value| usize::try_from(value).ok())
            .ok_or(ConnectionError::InvalidMessage)?;
        // 历史会把多个输入块直接拼接；按 UTF-8 字节区间提取附件，不扫描或删除普通路径。
        if start < cursor || start >= end {
            return Err(ConnectionError::InvalidMessage);
        }
        let path = text
            .get(start..end)
            .ok_or(ConnectionError::InvalidMessage)?;
        if !Path::new(path).is_absolute() {
            return Err(ConnectionError::InvalidMessage);
        }
        visible.push_str(&text[cursor..start]);
        cursor = end;
        attachments.push(json!({
            "id": path, "kind": metadata.kind, "mediaType": metadata.media_type,
            "name": metadata.name, "size": metadata.size,
        }));
    }
    if attachments.is_empty() {
        return Ok(None);
    }
    visible.push_str(&text[cursor..]);
    Ok(Some(FileTextInput {
        text: visible,
        attachments,
    }))
}

fn validate_metadata(metadata: &FileMetadata) -> Result<(), ConnectionError> {
    if !matches!(metadata.kind.as_str(), "file" | "text")
        || metadata.media_type.is_empty()
        || metadata.media_type.len() > 255
        || metadata.name.is_empty()
        || metadata.name.len() > 255
        || metadata.name.contains(['/', '\\', '\0', '\r', '\n'])
        || metadata.size == 0
        || metadata.size
            > if metadata.kind == "text" {
                MAX_TEXT_BYTES
            } else {
                MAX_FILE_BYTES
            }
    {
        return Err(ConnectionError::InvalidMessage);
    }
    Ok(())
}

fn required_string<'a>(
    object: &'a Map<String, Value>,
    key: &str,
) -> Result<&'a str, ConnectionError> {
    object
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or(ConnectionError::InvalidMessage)
}

fn required_size(object: &Map<String, Value>) -> Result<usize, ConnectionError> {
    object
        .get("size")
        .and_then(Value::as_u64)
        .and_then(|value| usize::try_from(value).ok())
        .ok_or(ConnectionError::InvalidMessage)
}

#[cfg(test)]
mod tests {
    use super::super::{
        connection::ServerMessage, conversation::map_item, conversation_events::map_server_message,
    };
    use super::*;

    #[test]
    fn attachment_paths_should_stay_out_of_history_and_live_message_text() {
        let directory = std::env::temp_dir().join("中文 附件");
        let file = json!({"id":directory.join("diagnostics.zip"), "kind":"file",
            "name":"diagnostics.zip", "mediaType":"application/zip", "size":17});
        // 用户主动输入的路径属于正文，只有带附件身份标记的独立内容块才隐藏。
        let text = "检查附件，并查看 /Users/example/source.rs";
        let native = json!({"id":"message-a", "type":"userMessage", "content":[
            {"type":"text", "text":text, "text_elements":[]},
            create_file_text_input(&file).unwrap(),
            {"type":"localImage", "path":directory.join("截图.png"), "detail":"original"}
        ]});
        let history = serde_json::to_value(map_item(native.clone()).unwrap()).unwrap();
        assert_eq!(history["text"], text);
        assert_eq!(history["attachments"].as_array().unwrap().len(), 2);
        assert_eq!(history["attachments"][0], file);
        assert_eq!(history["attachments"][1]["kind"], "image");
        for method in ["item/started", "item/completed"] {
            let event = map_server_message(
                ServerMessage {
                    id: None,
                    method: method.into(),
                    params: serde_json::value::to_raw_value(&json!({
                        "threadId":"thread-a", "turnId":"turn-a", "item":native
                    }))
                    .unwrap(),
                },
                1,
                "2026-09-15T00:00:00Z",
            )
            .unwrap()
            .unwrap();
            assert_eq!(event["payload"]["item"]["text"], text);
            assert_eq!(
                event["payload"]["item"]["attachments"],
                history["attachments"]
            );
        }
    }

    #[test]
    fn merged_history_attachment_paths_should_preserve_surrounding_unicode_text() {
        let mut merged = "检查附件🌟".to_owned();
        let mut elements = Vec::new();
        for name in ["报告.zip", "数据.json"] {
            let attachment = json!({"id":std::env::temp_dir().join(name), "kind":"file",
                "name":name, "mediaType":"application/octet-stream", "size":17});
            let input = create_file_text_input(&attachment).unwrap();
            let mut element = input["text_elements"][0].clone();
            let start = merged.len();
            merged.push_str(input["text"].as_str().unwrap());
            element["byteRange"] = json!({"start":start, "end":merged.len()});
            elements.push(element);
        }
        merged.push_str("，保留正文末尾。");
        let mapped = serde_json::to_value(
            map_item(json!({"id":"history-a", "type":"userMessage",
                "content":[{"type":"text", "text":merged, "text_elements":elements}]
            }))
            .unwrap(),
        )
        .unwrap();
        assert_eq!(mapped["text"], "检查附件🌟，保留正文末尾。");
        assert_eq!(mapped["attachments"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn attachment_ranges_should_reject_invalid_or_overlapping_spans() {
        let file = json!({"id":std::env::temp_dir().join("报告.zip"), "kind":"file",
            "name":"报告.zip", "mediaType":"application/zip", "size":17});
        let input = create_file_text_input(&file).unwrap();
        for range in [
            json!({"start":0,"end":u64::MAX}),
            json!({"start":2,"end":1}),
        ] {
            let mut invalid = input.clone();
            invalid["text_elements"][0]["byteRange"] = range;
            assert!(read_file_text_input(invalid.as_object().unwrap()).is_err());
        }
        let mut overlap = input.clone();
        overlap["text_elements"]
            .as_array_mut()
            .unwrap()
            .push(input["text_elements"][0].clone());
        assert!(read_file_text_input(overlap.as_object().unwrap()).is_err());
        let mut non_boundary = input;
        let path = non_boundary["text"].as_str().unwrap();
        let inside_character = path.find('报').unwrap() + 1;
        non_boundary["text_elements"][0]["byteRange"]["end"] = json!(inside_character);
        assert!(read_file_text_input(non_boundary.as_object().unwrap()).is_err());
    }

    #[test]
    fn unmarked_path_should_remain_user_text() {
        let input = json!({"type":"text", "text":"/Users/example/source.rs", "text_elements":[]});
        assert!(
            read_file_text_input(input.as_object().unwrap())
                .unwrap()
                .is_none()
        );
    }
}
