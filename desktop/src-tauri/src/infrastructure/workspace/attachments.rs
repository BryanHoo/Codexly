use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use serde::Serialize;
use sha2::{Digest, Sha256};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use crate::encoding::encode_lower_hex;

use super::path_guard::WorkspaceError;

const MAX_TEXT_BYTES: usize = 1024 * 1024;
const MAX_AUDIO_BYTES: usize = 50 * 1024 * 1024;
const MAX_FILE_BYTES: usize = 50 * 1024 * 1024;
const MAX_IMAGE_BYTES: usize = 512 * 1024 * 1024;
static TEMP_FILE_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Serialize)]
pub struct AttachmentResponse {
    pub attachment: Attachment,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub id: String,
    pub kind: &'static str,
    pub media_type: String,
    pub name: String,
    pub size: usize,
}

pub async fn store_attachment(
    app_data: &Path,
    project_id: &str,
    kind: &str,
    name: &str,
    bytes: &[u8],
) -> Result<AttachmentResponse, WorkspaceError> {
    validate_project_id(project_id)?;
    validate_name(name)?;
    let kind = validate_content(kind, name, bytes)?;
    let directory = attachment_directory(app_data, project_id);
    tokio::fs::create_dir_all(&directory).await?;
    let mut hasher = content_hasher(project_id, name);
    hasher.update(bytes);
    let hash = encode_lower_hex(hasher.finalize());
    let extension = safe_extension(name);
    let path = directory.join(format!("{hash}{extension}"));
    persist_bytes(&path, bytes).await?;
    Ok(AttachmentResponse {
        attachment: Attachment {
            id: path.to_string_lossy().into_owned(),
            kind,
            media_type: media_type(name, bytes).to_owned(),
            name: name.to_owned(),
            size: bytes.len(),
        },
    })
}

pub async fn import_attachment(
    app_data: &Path,
    project_id: &str,
    kind: &str,
    source: &str,
) -> Result<AttachmentResponse, WorkspaceError> {
    let source = tokio::fs::canonicalize(source).await?;
    let metadata = tokio::fs::metadata(&source).await?;
    if !metadata.is_file() {
        return Err(WorkspaceError::InvalidPath);
    }
    let size = usize::try_from(metadata.len()).map_err(|_| WorkspaceError::InvalidPath)?;
    let max_bytes = if kind == "file" && is_audio_name(name_from_path(&source)?) {
        MAX_AUDIO_BYTES
    } else {
        max_content_bytes(kind)?
    };
    if size > max_bytes {
        return Err(WorkspaceError::AttachmentTooLarge {
            maximum_bytes: max_bytes,
        });
    }
    let name = name_from_path(&source)?;
    if kind == "text" {
        let bytes = tokio::fs::read(&source).await?;
        return store_attachment(app_data, project_id, kind, name, &bytes).await;
    }
    validate_project_id(project_id)?;
    validate_name(name)?;
    let header = read_header(&source).await?;
    let verified_kind = match kind {
        "file" => "file",
        "image" if is_supported_image(name, &header) => "image",
        _ => return Err(WorkspaceError::InvalidPath),
    };
    let directory = attachment_directory(app_data, project_id);
    tokio::fs::create_dir_all(&directory).await?;

    // 单遍完成流式哈希和临时文件写入，WebView 与 Rust 堆都不保留完整副本。
    let destination = persist_streamed_file(&source, &directory, project_id, name, size).await?;
    Ok(AttachmentResponse {
        attachment: Attachment {
            id: destination.to_string_lossy().into_owned(),
            kind: verified_kind,
            media_type: media_type(name, &header).to_owned(),
            name: name.to_owned(),
            size,
        },
    })
}

pub async fn validate_attachment(
    app_data: &Path,
    project_id: &str,
    attachment_id: &str,
) -> Result<PathBuf, WorkspaceError> {
    validate_project_id(project_id)?;
    let directory = attachment_directory(app_data, project_id);
    let directory = tokio::fs::canonicalize(directory).await?;
    let path = tokio::fs::canonicalize(attachment_id).await?;
    if !path.starts_with(directory) || !tokio::fs::metadata(&path).await?.is_file() {
        return Err(WorkspaceError::InvalidPath);
    }
    Ok(path)
}

pub async fn validate_generated_attachment(
    app_data: &Path,
    attachment_id: &str,
) -> Result<PathBuf, WorkspaceError> {
    let directory = tokio::fs::canonicalize(app_data.join("attachments/generated")).await?;
    let path = tokio::fs::canonicalize(attachment_id).await?;
    if !path.starts_with(directory) || !tokio::fs::metadata(&path).await?.is_file() {
        return Err(WorkspaceError::InvalidPath);
    }
    Ok(path)
}

fn attachment_directory(app_data: &Path, project_id: &str) -> PathBuf {
    app_data.join("attachments").join(project_id)
}

fn validate_project_id(project_id: &str) -> Result<(), WorkspaceError> {
    if project_id.is_empty()
        || !project_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(WorkspaceError::InvalidPath);
    }
    Ok(())
}

fn validate_name(name: &str) -> Result<(), WorkspaceError> {
    if name.is_empty()
        || name.len() > 255
        || name.contains(['/', '\\', '\0', '\r', '\n'])
        || matches!(name, "." | "..")
    {
        return Err(WorkspaceError::InvalidPath);
    }
    Ok(())
}

fn validate_content(kind: &str, name: &str, bytes: &[u8]) -> Result<&'static str, WorkspaceError> {
    if bytes.is_empty() {
        return Err(WorkspaceError::InvalidPath);
    }
    match kind {
        "file" => validate_size(
            bytes.len(),
            if is_audio_name(name) {
                MAX_AUDIO_BYTES
            } else {
                MAX_FILE_BYTES
            },
            "file",
        ),
        "text" if std::str::from_utf8(bytes).is_ok() => {
            validate_size(bytes.len(), MAX_TEXT_BYTES, "text")
        }
        "image" if is_supported_image(name, bytes) => {
            validate_size(bytes.len(), MAX_IMAGE_BYTES, "image")
        }
        _ => Err(WorkspaceError::InvalidPath),
    }
}

fn validate_size(
    size: usize,
    maximum_bytes: usize,
    kind: &'static str,
) -> Result<&'static str, WorkspaceError> {
    if size > maximum_bytes {
        return Err(WorkspaceError::AttachmentTooLarge { maximum_bytes });
    }
    Ok(kind)
}

fn name_from_path(path: &Path) -> Result<&str, WorkspaceError> {
    path.file_name()
        .and_then(|value| value.to_str())
        .ok_or(WorkspaceError::InvalidPath)
}

fn is_audio_name(name: &str) -> bool {
    Path::new(name)
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| {
            matches!(
                value.to_ascii_lowercase().as_str(),
                "m4a" | "mp3" | "ogg" | "wav" | "webm"
            )
        })
}

fn max_content_bytes(kind: &str) -> Result<usize, WorkspaceError> {
    match kind {
        "file" => Ok(MAX_FILE_BYTES),
        "text" => Ok(MAX_TEXT_BYTES),
        "image" => Ok(MAX_IMAGE_BYTES),
        _ => Err(WorkspaceError::InvalidPath),
    }
}

async fn read_header(source: &Path) -> Result<Vec<u8>, WorkspaceError> {
    let mut header = [0_u8; 16];
    let mut file = tokio::fs::File::open(source).await?;
    let read = file.read(&mut header).await?;
    Ok(header[..read].to_vec())
}

fn safe_extension(name: &str) -> String {
    Path::new(name)
        .extension()
        .and_then(|value| value.to_str())
        .filter(|value| value.len() <= 16)
        .map(|value| format!(".{value}"))
        .unwrap_or_default()
}

fn content_hasher(project_id: &str, name: &str) -> Sha256 {
    let mut hasher = Sha256::new();
    hasher.update(project_id.as_bytes());
    hasher.update([0]);
    hasher.update(name.as_bytes());
    hasher.update([0]);
    hasher
}

fn temporary_path(directory: &Path) -> PathBuf {
    let sequence = TEMP_FILE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    directory.join(format!(".upload-{}-{sequence}.tmp", std::process::id()))
}

async fn persist_bytes(destination: &Path, bytes: &[u8]) -> Result<(), WorkspaceError> {
    if tokio::fs::try_exists(destination).await? {
        return Ok(());
    }
    let directory = destination.parent().ok_or(WorkspaceError::InvalidPath)?;
    let temporary = temporary_path(directory);
    let result = async {
        let mut file = tokio::fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)
            .await?;
        file.write_all(bytes).await?;
        file.flush().await?;
        file.sync_data().await?;
        commit_temporary(&temporary, destination).await
    }
    .await;
    if result.is_err() {
        let _ = tokio::fs::remove_file(&temporary).await;
    }
    result
}

async fn persist_streamed_file(
    source: &Path,
    directory: &Path,
    project_id: &str,
    name: &str,
    expected_size: usize,
) -> Result<PathBuf, WorkspaceError> {
    let temporary = temporary_path(directory);
    let result = async {
        let mut source_file = tokio::fs::File::open(source).await?;
        let mut temporary_file = tokio::fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)
            .await?;
        let mut hasher = content_hasher(project_id, name);
        let mut total = 0_usize;
        let mut buffer = vec![0_u8; 64 * 1024];
        loop {
            let read = source_file.read(&mut buffer).await?;
            if read == 0 {
                break;
            }
            total = total.checked_add(read).ok_or(WorkspaceError::InvalidPath)?;
            if total > expected_size {
                return Err(WorkspaceError::InvalidPath);
            }
            hasher.update(&buffer[..read]);
            temporary_file.write_all(&buffer[..read]).await?;
        }
        if total != expected_size {
            return Err(WorkspaceError::InvalidPath);
        }
        temporary_file.flush().await?;
        temporary_file.sync_data().await?;
        let destination = directory.join(format!(
            "{}{}",
            encode_lower_hex(hasher.finalize()),
            safe_extension(name)
        ));
        commit_temporary(&temporary, &destination).await?;
        Ok(destination)
    }
    .await;
    if result.is_err() {
        let _ = tokio::fs::remove_file(&temporary).await;
    }
    result
}

async fn commit_temporary(temporary: &Path, destination: &Path) -> Result<(), WorkspaceError> {
    if tokio::fs::try_exists(destination).await? {
        tokio::fs::remove_file(temporary).await?;
        return Ok(());
    }
    match tokio::fs::rename(temporary, destination).await {
        Ok(()) => Ok(()),
        Err(_) if tokio::fs::try_exists(destination).await? => {
            tokio::fs::remove_file(temporary).await?;
            Ok(())
        }
        Err(error) => Err(error.into()),
    }
}

fn is_supported_image(name: &str, bytes: &[u8]) -> bool {
    match Path::new(name)
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("png") => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
        Some("jpg" | "jpeg") => bytes.starts_with(&[0xff, 0xd8, 0xff]),
        Some("gif") => bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a"),
        Some("webp") => bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP"),
        _ => false,
    }
}

fn media_type(name: &str, bytes: &[u8]) -> &'static str {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return "image/png";
    }
    if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        return "image/jpeg";
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return "image/gif";
    }
    if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        return "image/webp";
    }
    if bytes.starts_with(b"%PDF-") {
        return "application/pdf";
    }
    if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WAVE") {
        return "audio/wav";
    }
    if bytes.starts_with(b"OggS") {
        return "audio/ogg";
    }
    if bytes.starts_with(b"ID3") || bytes.starts_with(&[0xff, 0xfb]) {
        return "audio/mpeg";
    }

    match Path::new(name)
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("doc") => "application/msword",
        Some("docx") => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        Some("ppt") => "application/vnd.ms-powerpoint",
        Some("pptx") => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        Some("xls") => "application/vnd.ms-excel",
        Some("xlsx") => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        Some("csv") => "text/csv",
        Some("mp3") => "audio/mpeg",
        Some("m4a") => "audio/mp4",
        Some("ogg") => "audio/ogg",
        Some("wav") => "audio/wav",
        Some("webm") => "audio/webm",
        Some("md") => "text/markdown",
        Some("json") => "application/json",
        Some("rs") => "text/x-rust",
        Some("ts" | "tsx") => "text/x-typescript",
        Some("txt") => "text/plain",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use std::{fs, time::SystemTime};

    use super::*;

    #[tokio::test]
    async fn attachment_cache_should_validate_project_scope_and_image_content() {
        let unique = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("codeagent-attachments-{unique}"));
        let png = b"\x89PNG\r\n\x1a\ncontent";
        let response = store_attachment(&root, "project-a", "image", "test.png", png)
            .await
            .unwrap();
        assert_eq!(response.attachment.media_type, "image/png");
        assert!(
            validate_attachment(&root, "project-a", &response.attachment.id)
                .await
                .is_ok()
        );
        assert!(
            validate_attachment(&root, "project-b", &response.attachment.id)
                .await
                .is_err()
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn attachment_cache_should_accept_generated_text_and_binary_path_files() {
        let unique = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("codeagent-text-attachments-{unique}"));

        let generated = store_attachment(
            &root,
            "project-a",
            "text",
            "Pasted text.txt",
            "生成的附件".as_bytes(),
        )
        .await
        .expect("generated UTF-8 text should be cached");
        assert_eq!(generated.attachment.kind, "text");

        let binary = store_attachment(&root, "project-a", "file", "document.pdf", b"%PDF-\xff\xfe")
            .await
            .expect("binary files should remain available through a local path");
        assert_eq!(binary.attachment.kind, "file");
        assert_eq!(binary.attachment.media_type, "application/pdf");

        let source = root.join("document.pdf");
        fs::write(&source, b"%PDF-\xff\xfe").unwrap();
        let imported = import_attachment(&root, "project-a", "file", source.to_str().unwrap())
            .await
            .expect("host import should use the same content address");
        assert_eq!(imported.attachment.id, binary.attachment.id);

        fs::remove_dir_all(root).unwrap();
    }
}

#[cfg(test)]
#[path = "attachment_limit_tests.rs"]
mod attachment_limit_tests;
