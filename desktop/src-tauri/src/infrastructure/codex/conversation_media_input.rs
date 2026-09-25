use std::path::Path;

use serde_json::{Map, Value, json};

use super::connection::ConnectionError;

pub(super) fn map_local_audio_attachment(
    object: &Map<String, Value>,
) -> Result<Value, ConnectionError> {
    let path = Path::new(required_string(object, "path")?);
    file_attachment(path, "file", audio_media_type(path), None)
}

pub(super) fn map_local_image_attachment(
    object: &Map<String, Value>,
) -> Result<Value, ConnectionError> {
    let path = Path::new(required_string(object, "path")?);
    let detail = match object.get("detail").and_then(Value::as_str) {
        None => "auto",
        Some(detail @ ("auto" | "low" | "high" | "original")) => detail,
        Some(_) => return Err(ConnectionError::InvalidMessage),
    };
    file_attachment(path, "image", image_media_type(path), Some(detail))
}

fn file_attachment(
    path: &Path,
    kind: &str,
    media_type: &str,
    detail: Option<&str>,
) -> Result<Value, ConnectionError> {
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .ok_or(ConnectionError::InvalidMessage)?;
    let size = std::fs::metadata(path)
        .ok()
        .and_then(|metadata| usize::try_from(metadata.len()).ok())
        .filter(|size| *size > 0)
        .unwrap_or(1);
    let mut attachment = json!({
        "id": path.to_string_lossy(), "kind": kind, "mediaType": media_type,
        "name": name, "size": size,
    });
    if let Some(detail) = detail {
        attachment["detail"] = Value::String(detail.to_owned());
    }
    Ok(attachment)
}

fn audio_media_type(path: &Path) -> &'static str {
    match extension(path).as_deref() {
        Some("m4a") => "audio/mp4",
        Some("ogg") => "audio/ogg",
        Some("wav") => "audio/wav",
        Some("webm") => "audio/webm",
        _ => "audio/mpeg",
    }
}

fn image_media_type(path: &Path) -> &'static str {
    match extension(path).as_deref() {
        Some("gif") => "image/gif",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        _ => "image/png",
    }
}

fn extension(path: &Path) -> Option<String> {
    path.extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
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
