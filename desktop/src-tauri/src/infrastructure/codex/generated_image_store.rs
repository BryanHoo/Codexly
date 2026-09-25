use std::{
    collections::HashMap,
    fs::File,
    io::{Cursor, Read, Write},
    path::{Path, PathBuf},
};

use base64::{engine::general_purpose::STANDARD, read::DecoderReader};
use serde_json::value::RawValue;
use sha2::{Digest, Sha256};

use crate::encoding::encode_lower_hex;

pub(super) const IMAGE_ATTACHMENT_FIELD: &str = "codeagentAttachment";
const IMAGE_GENERATION_MARKER: &[u8] = b"\"imageGeneration\"";
const MAX_GENERATED_IMAGE_BYTES: usize = 50 * 1024 * 1024;
const COPY_BUFFER_BYTES: usize = 64 * 1024;

#[derive(Clone)]
pub(super) struct GeneratedImageStore {
    directory: PathBuf,
}

struct ImageOccurrence<'a> {
    object_insert: usize,
    result: Option<&'a RawValue>,
    attachment: Option<&'a RawValue>,
    saved_path: Option<String>,
    completed: bool,
}

struct StoredImage {
    path: PathBuf,
    media_type: &'static str,
    extension: &'static str,
    size: usize,
}

struct Edit {
    start: usize,
    end: usize,
    replacement: Vec<u8>,
}

impl GeneratedImageStore {
    pub(super) fn new(app_data: &Path) -> Self {
        Self {
            directory: app_data.join("attachments/generated"),
        }
    }

    pub(super) const fn marker_len() -> usize {
        IMAGE_GENERATION_MARKER.len()
    }

    pub(super) fn contains_image_generation(frame: &[u8]) -> bool {
        memchr::memmem::find(frame, IMAGE_GENERATION_MARKER).is_some()
    }

    pub(super) fn sanitize_frame(&self, frame: Vec<u8>) -> Result<Vec<u8>, serde_json::Error> {
        let root: &RawValue = serde_json::from_slice(&frame)?;
        let mut images = Vec::new();
        collect_image_occurrences(root, &frame, &mut images)?;
        if images.is_empty() {
            return Ok(frame);
        }

        let mut edits = Vec::with_capacity(images.len() * 2);
        for image in images {
            let stored = image.completed.then(|| self.store_image(&image)).flatten();
            if let Some(result) = image.result {
                let (start, end) = raw_span(result, &frame);
                edits.push(Edit {
                    start,
                    end,
                    replacement: b"null".to_vec(),
                });
            }

            let mut insertion = Vec::new();
            if image.result.is_none() {
                insertion.extend_from_slice(b",\"result\":null");
            }
            if let Some(stored) = stored {
                let metadata = attachment_json(&stored)?;
                if let Some(attachment) = image.attachment {
                    let (start, end) = raw_span(attachment, &frame);
                    edits.push(Edit {
                        start,
                        end,
                        replacement: metadata,
                    });
                } else {
                    insertion.extend_from_slice(b",\"");
                    insertion.extend_from_slice(IMAGE_ATTACHMENT_FIELD.as_bytes());
                    insertion.extend_from_slice(b"\":");
                    insertion.extend_from_slice(&metadata);
                }
            }
            if !insertion.is_empty() {
                edits.push(Edit {
                    start: image.object_insert,
                    end: image.object_insert,
                    replacement: insertion,
                });
            }
        }

        edits.sort_unstable_by_key(|edit| edit.start);
        let mut sanitized = Vec::with_capacity(frame.len().min(8 * 1024));
        let mut cursor = 0;
        for edit in edits {
            debug_assert!(edit.start >= cursor);
            sanitized.extend_from_slice(&frame[cursor..edit.start]);
            sanitized.extend_from_slice(&edit.replacement);
            cursor = edit.end;
        }
        sanitized.extend_from_slice(&frame[cursor..]);
        Ok(sanitized)
    }

    fn store_image(&self, image: &ImageOccurrence<'_>) -> Option<StoredImage> {
        // Codex 已落盘时直接复制文件，避免扫描和解码帧内的大型 Base64 字段。
        image
            .saved_path
            .as_deref()
            .and_then(|path| self.store_saved_path(path))
            .or_else(|| image.result.and_then(|result| self.store_base64(result)))
    }

    fn store_saved_path(&self, path: &str) -> Option<StoredImage> {
        let file = File::open(path).ok()?;
        let metadata = file.metadata().ok()?;
        let size = usize::try_from(metadata.len()).ok()?;
        if !metadata.is_file() || size == 0 || size > MAX_GENERATED_IMAGE_BYTES {
            return None;
        }
        self.store_reader(file)
    }

    fn store_base64(&self, result: &RawValue) -> Option<StoredImage> {
        let literal = result.get().as_bytes();
        let encoded = literal.strip_prefix(b"\"")?.strip_suffix(b"\"")?;
        let max_encoded = MAX_GENERATED_IMAGE_BYTES.div_ceil(3) * 4;
        if encoded.is_empty() || encoded.len() > max_encoded || encoded.contains(&b'\\') {
            return None;
        }
        let decoder = DecoderReader::new(Cursor::new(encoded), &STANDARD);
        self.store_reader(decoder)
    }

    fn store_reader(&self, reader: impl Read) -> Option<StoredImage> {
        let mut file = crate::infrastructure::atomic_file::create(&self.directory).ok()?;
        let mut reader = reader.take((MAX_GENERATED_IMAGE_BYTES + 1) as u64);
        let mut hasher = Sha256::new();
        let mut header = [0_u8; 12];
        let mut header_len = 0;
        let mut total = 0;
        let mut buffer = [0_u8; COPY_BUFFER_BYTES];

        let write_result = (|| -> std::io::Result<()> {
            loop {
                let read = reader.read(&mut buffer)?;
                if read == 0 {
                    break;
                }
                total += read;
                if total > MAX_GENERATED_IMAGE_BYTES {
                    return Err(std::io::Error::other("generated image exceeds size limit"));
                }
                let header_copy = (header.len() - header_len).min(read);
                header[header_len..header_len + header_copy]
                    .copy_from_slice(&buffer[..header_copy]);
                header_len += header_copy;
                hasher.update(&buffer[..read]);
                file.write_all(&buffer[..read])?;
            }
            file.as_file().sync_all()
        })();

        let (media_type, extension) = write_result
            .ok()
            .filter(|_| total > 0)
            .and_then(|_| detect_image(&header[..header_len]))?;
        let digest = encode_lower_hex(hasher.finalize());
        let destination = self.directory.join(format!("{digest}.{extension}"));
        if !destination.is_file()
            && crate::infrastructure::atomic_file::publish(file, &destination).is_err()
            && !destination.is_file()
        {
            return None;
        }
        Some(StoredImage {
            path: destination,
            media_type,
            extension,
            size: total,
        })
    }
}

fn collect_image_occurrences<'a>(
    raw: &'a RawValue,
    frame: &[u8],
    images: &mut Vec<ImageOccurrence<'a>>,
) -> Result<(), serde_json::Error> {
    match raw
        .get()
        .as_bytes()
        .iter()
        .find(|byte| !byte.is_ascii_whitespace())
    {
        Some(b'{') => {
            let fields: HashMap<String, &'a RawValue> = serde_json::from_str(raw.get())?;
            let is_image = fields
                .get("type")
                .and_then(|value| serde_json::from_str::<&str>(value.get()).ok())
                == Some("imageGeneration");
            if is_image {
                let (object_start, _) = raw_span(raw, frame);
                let closing_brace = raw
                    .get()
                    .as_bytes()
                    .iter()
                    .rposition(|byte| !byte.is_ascii_whitespace())
                    .expect("JSON object is not empty");
                images.push(ImageOccurrence {
                    object_insert: object_start + closing_brace,
                    result: fields.get("result").copied(),
                    attachment: fields.get(IMAGE_ATTACHMENT_FIELD).copied(),
                    saved_path: fields
                        .get("savedPath")
                        .and_then(|value| serde_json::from_str::<String>(value.get()).ok()),
                    completed: fields
                        .get("status")
                        .and_then(|value| serde_json::from_str::<&str>(value.get()).ok())
                        == Some("completed"),
                });
            } else {
                for value in fields.values() {
                    collect_image_occurrences(value, frame, images)?;
                }
            }
        }
        Some(b'[') => {
            let values: Vec<&'a RawValue> = serde_json::from_str(raw.get())?;
            for value in values {
                collect_image_occurrences(value, frame, images)?;
            }
        }
        _ => {}
    }
    Ok(())
}

fn raw_span(raw: &RawValue, frame: &[u8]) -> (usize, usize) {
    let start = raw.get().as_ptr() as usize - frame.as_ptr() as usize;
    (start, start + raw.get().len())
}

fn attachment_json(stored: &StoredImage) -> Result<Vec<u8>, serde_json::Error> {
    serde_json::to_vec(&serde_json::json!({
        "id": stored.path.to_string_lossy(),
        "kind": "image",
        "mediaType": stored.media_type,
        "name": format!("generated-image.{}", stored.extension),
        "size": stored.size,
    }))
}

fn detect_image(content: &[u8]) -> Option<(&'static str, &'static str)> {
    if content.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some(("image/png", "png"))
    } else if content.starts_with(&[0xff, 0xd8, 0xff]) {
        Some(("image/jpeg", "jpg"))
    } else if content.starts_with(b"GIF87a") || content.starts_with(b"GIF89a") {
        Some(("image/gif", "gif"))
    } else if content.starts_with(b"RIFF") && content.get(8..12) == Some(b"WEBP") {
        Some(("image/webp", "webp"))
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::time::SystemTime;

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    use base64::write::EncoderWriter;
    use serde_json::Value;

    use super::*;

    fn test_root(label: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("codeagent-generated-image-{label}-{unique}"))
    }

    #[test]
    fn image_generation_frame_should_store_body_and_keep_only_metadata() {
        let root = test_root("base64");
        let store = GeneratedImageStore::new(&root);
        let encoded = "iVBORw0KGgo=";
        let frame = format!(
            r#"{{"method":"item/completed","params":{{"item":{{"type":"imageGeneration","id":"image-a","result":"{encoded}","status":"completed"}}}}}}"#
        );

        let sanitized = store.sanitize_frame(frame.into_bytes()).unwrap();
        let value: Value = serde_json::from_slice(&sanitized).unwrap();
        let attachment = &value["params"]["item"][IMAGE_ATTACHMENT_FIELD];

        assert_eq!(value["params"]["item"]["result"], Value::Null);
        assert_eq!(attachment["mediaType"], "image/png");
        assert_eq!(attachment["size"], 8);
        assert!(!String::from_utf8(sanitized).unwrap().contains(encoded));
        assert!(Path::new(attachment["id"].as_str().unwrap()).is_file());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn saved_path_should_be_preferred_over_base64_result() {
        let root = test_root("saved-path");
        fs::create_dir_all(&root).unwrap();
        let source = root.join("source.png");
        fs::write(&source, b"\x89PNG\r\n\x1a\nsaved").unwrap();
        let frame = serde_json::to_vec(&serde_json::json!({
            "method": "item/completed",
            "params": {"item": {
                "type": "imageGeneration",
                "status": "completed",
                "savedPath": source,
                "result": "not-valid-base64"
            }}
        }))
        .unwrap();

        let sanitized = GeneratedImageStore::new(&root)
            .sanitize_frame(frame)
            .unwrap();
        let value: Value = serde_json::from_slice(&sanitized).unwrap();
        let attachment = &value["params"]["item"][IMAGE_ATTACHMENT_FIELD];

        assert_eq!(attachment["size"], 13);
        assert_eq!(value["params"]["item"]["result"], Value::Null);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    #[ignore = "manual peak RSS baseline"]
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    fn performance_baseline_generated_image_peak_rss() {
        const CHILD_ROOT: &str = "CODEAGENT_IMAGE_RSS_CHILD_ROOT";
        if let Some(root) = std::env::var_os(CHILD_ROOT) {
            run_max_image_workload(Path::new(&root));
            return;
        }

        let root = test_root("rss");
        let mut command = std::process::Command::new("/usr/bin/time");
        if cfg!(target_os = "macos") {
            command.arg("-l");
        } else {
            command.arg("-v");
        }
        let output = command
            .arg(std::env::current_exe().unwrap())
            .arg("performance_baseline_generated_image_peak_rss")
            .arg("--ignored")
            .arg("--nocapture")
            .env(CHILD_ROOT, &root)
            .output()
            .unwrap();
        assert!(output.status.success());

        let stderr = String::from_utf8(output.stderr).unwrap();
        let line = stderr
            .lines()
            .find(|line| {
                line.to_ascii_lowercase()
                    .contains("maximum resident set size")
            })
            .expect("time should report maximum resident set size");
        let measured = line
            .split_whitespace()
            .filter_map(|part| part.parse::<u64>().ok())
            .next_back()
            .unwrap();
        let peak_rss_bytes = if cfg!(target_os = "linux") {
            measured * 1024
        } else {
            measured
        };
        println!(
            "PERFORMANCE_BASELINE {{\"benchmark\":\"generated_image_peak_rss\",\"imageBytes\":{MAX_GENERATED_IMAGE_BYTES},\"peakRssBytes\":{peak_rss_bytes}}}"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    fn run_max_image_workload(root: &Path) {
        let mut frame = br#"{"method":"item/completed","params":{"item":{"type":"imageGeneration","status":"completed","result":""#.to_vec();
        {
            let mut encoder = EncoderWriter::new(&mut frame, &STANDARD);
            encoder.write_all(b"\x89PNG\r\n\x1a\n").unwrap();
            let block = [0_u8; COPY_BUFFER_BYTES];
            let mut remaining = MAX_GENERATED_IMAGE_BYTES - 8;
            while remaining > 0 {
                let write = remaining.min(block.len());
                encoder.write_all(&block[..write]).unwrap();
                remaining -= write;
            }
            encoder.finish().unwrap();
        }
        frame.extend_from_slice(br#""}}}"#);

        let sanitized = GeneratedImageStore::new(root)
            .sanitize_frame(frame)
            .unwrap();
        let value: Value = serde_json::from_slice(&sanitized).unwrap();
        assert_eq!(
            value["params"]["item"][IMAGE_ATTACHMENT_FIELD]["size"],
            MAX_GENERATED_IMAGE_BYTES
        );
    }
}
