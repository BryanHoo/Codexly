use std::path::Path;

use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde_json::Value;
use tauri::{AppHandle, Manager, State, ipc::InvokeBody, ipc::Request};

use super::{error::AppError, state::AppState, task_workspace};
use crate::infrastructure::filesystem::list_host_files as read_host_files;
use crate::{domain::conversation::AgentPromptInput, infrastructure::workspace};

const MAX_TEXT_BYTES: u64 = 1024 * 1024;
const MAX_AUDIO_BYTES: u64 = 50 * 1024 * 1024;
const MAX_FILE_BYTES: u64 = 50 * 1024 * 1024;
const MAX_IMAGE_BYTES: u64 = 512 * 1024 * 1024;
const MAX_IMAGES: u64 = 1_500;

#[derive(Default)]
struct AttachmentBudget {
    file_bytes: u64,
    image_bytes: u64,
    image_count: u64,
}

impl AttachmentBudget {
    fn add(&mut self, kind: &str, size: u64) -> Result<(), AppError> {
        if kind == "image" {
            self.image_bytes = self
                .image_bytes
                .checked_add(size)
                .ok_or(AppError::FilesystemRequestFailed)?;
            self.image_count += 1;
            if self.image_bytes > MAX_IMAGE_BYTES || self.image_count > MAX_IMAGES {
                return Err(AppError::FilesystemRequestFailed);
            }
        } else {
            self.file_bytes = self
                .file_bytes
                .checked_add(size)
                .ok_or(AppError::FilesystemRequestFailed)?;
            if self.file_bytes > MAX_FILE_BYTES {
                return Err(AppError::FilesystemRequestFailed);
            }
        }
        Ok(())
    }
}

#[tauri::command(rename_all = "camelCase")]
pub async fn list_host_files(
    app: AppHandle,
    kind: String,
    path: Option<String>,
    include_hidden: bool,
) -> Result<Value, AppError> {
    let home = app
        .path()
        .home_dir()
        .map_err(|_| AppError::HomeDirectoryUnavailable)?;
    let response = read_host_files(&home, path.as_deref(), &kind, include_hidden)
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    serde_json::to_value(response).map_err(|_| AppError::FilesystemRequestFailed)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn upload_attachment(app: AppHandle, request: Request<'_>) -> Result<Value, AppError> {
    let bytes = match request.body() {
        InvokeBody::Raw(bytes) => bytes.as_slice(),
        InvokeBody::Json(_) => return Err(AppError::FilesystemRequestFailed),
    };
    let project_id = required_header(&request, "x-codeagent-project-id")?;
    let kind = required_header(&request, "x-codeagent-kind")?;
    let encoded_name = required_header(&request, "x-codeagent-name")?;
    let name = STANDARD
        .decode(encoded_name)
        .ok()
        .and_then(|value| String::from_utf8(value).ok())
        .ok_or(AppError::FilesystemRequestFailed)?;
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    store_attachment_without_codex(&app_data, project_id, kind, &name, bytes).await
}

fn required_header<'a>(request: &'a Request<'_>, name: &str) -> Result<&'a str, AppError> {
    request
        .headers()
        .get(name)
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.is_empty())
        .ok_or(AppError::FilesystemRequestFailed)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn import_host_attachment(
    app: AppHandle,
    project_id: String,
    kind: String,
    path: String,
) -> Result<Value, AppError> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    import_attachment_without_codex(&app_data, &project_id, &kind, &path).await
}

async fn store_attachment_without_codex(
    app_data: &Path,
    project_id: &str,
    kind: &str,
    name: &str,
    bytes: &[u8],
) -> Result<Value, AppError> {
    let response = workspace::store_attachment(app_data, project_id, kind, name, bytes)
        .await
        .map_err(AppError::from)?;
    serde_json::to_value(response).map_err(|_| AppError::FilesystemRequestFailed)
}

async fn import_attachment_without_codex(
    app_data: &Path,
    project_id: &str,
    kind: &str,
    path: &str,
) -> Result<Value, AppError> {
    let response = workspace::import_attachment(app_data, project_id, kind, path)
        .await
        .map_err(AppError::from)?;
    serde_json::to_value(response).map_err(|_| AppError::FilesystemRequestFailed)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn cache_project_image(
    app: AppHandle,
    project_id: String,
    root_path: Option<String>,
    task_id: Option<String>,
    path: String,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let canonical_root = task_workspace::resolve_preview_root(
        &state,
        &project_id,
        task_id.as_deref(),
        root_path.as_deref(),
        &path,
    )
    .await?;
    let relative = task_workspace::relative_preview_path(&canonical_root, &path)?;
    let image_path = workspace::resolve_existing(&canonical_root, Some(&relative))
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    if !image_path.is_file() || !is_image_path(&image_path) {
        return Err(AppError::FilesystemRequestFailed);
    }
    let response = workspace::import_attachment(
        &app.path()
            .app_data_dir()
            .map_err(|_| AppError::FilesystemRequestFailed)?,
        &project_id,
        "image",
        image_path
            .to_str()
            .ok_or(AppError::FilesystemRequestFailed)?,
    )
    .await
    .map_err(|_| AppError::FilesystemRequestFailed)?;
    serde_json::to_value(response).map_err(|_| AppError::FilesystemRequestFailed)
}

pub async fn resolve_prompt_attachments(
    app_data: &Path,
    project_id: &str,
    task_id: &str,
    input: &mut AgentPromptInput,
) -> Result<(), AppError> {
    use crate::infrastructure::temporary_task_storage;
    if input.attachments.is_empty() {
        return Ok(());
    }
    let task_root = temporary_task_storage::root(app_data, project_id, task_id)
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    let mut budget = AttachmentBudget::default();
    for attachment in &mut input.attachments {
        let object = attachment
            .as_object_mut()
            .ok_or(AppError::FilesystemRequestFailed)?;
        let id = object
            .get("id")
            .and_then(Value::as_str)
            .ok_or(AppError::FilesystemRequestFailed)?;
        let path = temporary_task_storage::validate_attachment_in_root(
            app_data,
            project_id,
            task_id,
            task_root.as_deref(),
            id,
        )
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)?;
        let metadata = tokio::fs::metadata(&path)
            .await
            .map_err(|_| AppError::FilesystemRequestFailed)?;
        let expected_size = object.get("size").and_then(Value::as_u64);
        let kind = object.get("kind").and_then(Value::as_str);
        let name = object.get("name").and_then(Value::as_str);
        let media_type = object.get("mediaType").and_then(Value::as_str);
        let detail = object.get("detail").and_then(Value::as_str);
        let max_bytes = match kind {
            Some("image")
                if is_image_path(&path)
                    && detail.is_none_or(|value| {
                        matches!(value, "auto" | "low" | "high" | "original")
                    }) =>
            {
                MAX_IMAGE_BYTES
            }
            Some("text") if detail.is_none() => MAX_TEXT_BYTES,
            Some("file") if detail.is_none() && is_audio_path(&path) => MAX_AUDIO_BYTES,
            Some("file") if detail.is_none() => MAX_FILE_BYTES,
            _ => return Err(AppError::FilesystemRequestFailed),
        };
        if metadata.len() > max_bytes
            || expected_size != Some(metadata.len())
            || name.is_none_or(|value| {
                value.is_empty()
                    || value.len() > 255
                    || value.contains(['/', '\\', '\0', '\r', '\n'])
            })
            || media_type.is_none_or(|value| value.is_empty() || value.len() > 255)
        {
            return Err(AppError::FilesystemRequestFailed);
        }
        budget.add(
            kind.ok_or(AppError::FilesystemRequestFailed)?,
            metadata.len(),
        )?;
        let retained = match &task_root {
            Some(root) => temporary_task_storage::retain_attachment(
                root,
                &path,
                kind.ok_or(AppError::FilesystemRequestFailed)?,
            )
            .await
            .map_err(|_| AppError::FilesystemRequestFailed)?,
            None => path,
        };
        object.insert(
            "id".to_owned(),
            Value::String(retained.to_string_lossy().into_owned()),
        );
    }
    Ok(())
}

fn is_audio_path(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| {
            matches!(
                value.to_ascii_lowercase().as_str(),
                "m4a" | "mp3" | "ogg" | "wav" | "webm"
            )
        })
}

fn is_image_path(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| {
            matches!(
                value.to_ascii_lowercase().as_str(),
                "png" | "jpg" | "jpeg" | "gif" | "webp"
            )
        })
}

#[cfg(test)]
mod tests {
    use std::{fs, time::SystemTime};

    use super::*;

    #[test]
    fn attachment_budget_should_enforce_combined_limits() {
        let mut files = AttachmentBudget::default();
        files.add("file", MAX_FILE_BYTES - 1).unwrap();
        assert!(files.add("text", 2).is_err());

        let mut images = AttachmentBudget::default();
        images.add("image", MAX_IMAGE_BYTES).unwrap();
        assert!(images.add("image", 1).is_err());

        let mut image_count = AttachmentBudget::default();
        for _ in 0..MAX_IMAGES {
            image_count.add("image", 1).unwrap();
        }
        assert!(image_count.add("image", 1).is_err());
    }

    #[tokio::test]
    async fn temporary_scope_should_import_json_without_a_codex_project() {
        let unique = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("codeagent-command-attachments-{unique}"));
        let source = root.join("capslock-plus.json");
        fs::create_dir_all(&root).unwrap();
        fs::write(&source, br#"{"enabled":true}"#).unwrap();

        let response = import_attachment_without_codex(
            &root.join("app-data"),
            "temporary",
            "file",
            source.to_str().unwrap(),
        )
        .await
        .expect("temporary attachment should not require project/read");

        assert_eq!(response["attachment"]["kind"], "file");
        assert_eq!(response["attachment"]["name"], "capslock-plus.json");
        fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn oversized_import_should_preserve_a_structured_error() {
        let unique = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("codeagent-command-oversized-{unique}"));
        fs::create_dir_all(&root).unwrap();
        let source = root.join("archive.zip");
        fs::File::create(&source)
            .unwrap()
            .set_len(MAX_FILE_BYTES + 1)
            .unwrap();

        let error = import_attachment_without_codex(
            &root.join("app-data"),
            "temporary",
            "file",
            source.to_str().unwrap(),
        )
        .await
        .expect_err("oversized import should fail");

        assert_eq!(
            serde_json::to_value(error).unwrap(),
            serde_json::json!({
                "code": "ATTACHMENT_TOO_LARGE",
                "message": "attachment exceeds the 52428800 byte limit",
            })
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn temporary_prompt_should_store_attachments_in_its_own_task_directory() {
        use crate::infrastructure::temporary_workspace;
        let root = std::env::temp_dir().join(format!(
            "codeagent-task-input-{}",
            SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let pending = temporary_workspace::create(&root).await.unwrap();
        let task_root = temporary_workspace::bind_task(&root, &pending, "thread-input")
            .await
            .unwrap();
        let staged =
            store_attachment_without_codex(&root, "temporary", "file", "report.json", b"{}")
                .await
                .unwrap();
        let mut input = AgentPromptInput {
            attachments: vec![staged["attachment"].clone()],
            skills: vec![],
            text: "Read it".into(),
        };
        resolve_prompt_attachments(&root, "temporary", "thread-input", &mut input)
            .await
            .unwrap();
        let id = input.attachments[0]["id"].as_str().unwrap().to_owned();
        assert!(Path::new(&id).starts_with(&task_root));
        assert_eq!(fs::read(&id).unwrap(), b"{}");
        resolve_prompt_attachments(&root, "temporary", "thread-input", &mut input)
            .await
            .unwrap();
        assert_eq!(input.attachments[0]["id"], id);
        fs::remove_dir_all(root).unwrap();
    }
}
