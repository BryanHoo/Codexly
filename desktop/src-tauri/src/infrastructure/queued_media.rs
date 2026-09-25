use std::{
    fs,
    io::{self, Read, Write},
    path::{Path, PathBuf},
};

use base64::{engine::general_purpose::STANDARD, read::DecoderReader};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use crate::encoding::encode_lower_hex;

const MAX_MEDIA_BYTES: usize = 50 * 1024 * 1024;

#[derive(Clone)]
pub(crate) struct QueuedMediaStore {
    app_data: PathBuf,
}

/// 队列快照按任务隔离，不能借另一个任务的附件身份绕过提交校验。
pub(crate) fn scope(task_id: &str) -> String {
    format!(
        "queued-{}",
        encode_lower_hex(Sha256::digest(task_id.as_bytes()))
    )
}

impl QueuedMediaStore {
    pub(crate) fn new(app_data: &Path) -> Self {
        Self {
            app_data: app_data.to_owned(),
        }
    }

    pub(crate) fn restore(&self, task_id: &str, input: &Value) -> io::Result<Value> {
        let image = match input["type"].as_str() {
            Some("image") => true,
            Some("audio") => false,
            _ => return Err(invalid()),
        };
        let detail = match input.get("detail").and_then(Value::as_str) {
            None => "auto",
            Some(value @ ("auto" | "low" | "high" | "original")) => value,
            Some(_) => return Err(invalid()),
        };
        let url = input["url"].as_str().ok_or_else(invalid)?;
        let (header, encoded) = url.split_once(";base64,").ok_or_else(invalid)?;
        let media_type = header.strip_prefix("data:").ok_or_else(invalid)?;
        let extension = match (image, media_type) {
            (true, "image/png") => "png",
            (true, "image/jpeg") => "jpg",
            (true, "image/gif") => "gif",
            (true, "image/webp") => "webp",
            (false, "audio/mpeg") => "mp3",
            (false, "audio/mp4") => "m4a",
            (false, "audio/wav") => "wav",
            (false, "audio/ogg") => "ogg",
            (false, "audio/webm") => "webm",
            _ => return Err(invalid()),
        };
        if encoded.is_empty() || encoded.len() > MAX_MEDIA_BYTES.div_ceil(3) * 4 {
            return Err(invalid());
        }
        // 对编码内容取摘要即可命中同一快照，轮询和重试不重复解码、写盘。
        let digest = encode_lower_hex(Sha256::digest(url.as_bytes()));
        let directory = self.app_data.join("attachments").join(scope(task_id));
        let path = directory.join(format!("{digest}.{extension}"));
        let size = match fs::metadata(&path) {
            Ok(metadata) if metadata.is_file() => metadata.len(),
            Ok(_) => return Err(invalid()),
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                persist(&path, encoded, image)?
            }
            Err(error) => return Err(error),
        };
        if size == 0 || size > MAX_MEDIA_BYTES as u64 {
            return Err(invalid());
        }
        let mut attachment = json!({
            "id":path, "kind":if image {"image"} else {"file"},
            "mediaType":media_type, "name":format!("queued-media.{extension}"), "size":size,
        });
        if image {
            attachment["detail"] = json!(detail);
        }
        Ok(attachment)
    }
}

fn persist(destination: &Path, encoded: &str, image: bool) -> io::Result<u64> {
    super::atomic_file::write_with(destination, |file| {
        let mut decoder = DecoderReader::new(encoded.as_bytes(), &STANDARD);
        let mut buffer = [0_u8; 64 * 1024];
        let mut prefix = Vec::with_capacity(12);
        let mut total = 0_usize;
        loop {
            let count = decoder.read(&mut buffer)?;
            if count == 0 {
                break;
            }
            total += count;
            if total > MAX_MEDIA_BYTES {
                return Err(invalid());
            }
            prefix.extend_from_slice(&buffer[..count.min(12 - prefix.len())]);
            file.write_all(&buffer[..count])?;
        }
        if total == 0 || (image && !is_image(&prefix)) {
            return Err(invalid());
        }
        file.sync_all()?;
        Ok(total as u64)
    })
}

fn is_image(bytes: &[u8]) -> bool {
    bytes.starts_with(b"\x89PNG\r\n\x1a\n")
        || bytes.starts_with(&[0xff, 0xd8, 0xff])
        || bytes.starts_with(b"GIF87a")
        || bytes.starts_with(b"GIF89a")
        || (bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP"))
}

fn invalid() -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, "invalid queued media snapshot")
}

#[cfg(test)]
#[path = "queued_media_tests.rs"]
mod tests;
