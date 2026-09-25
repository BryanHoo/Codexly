use std::{
    collections::BTreeMap,
    io,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::{fs, sync::Mutex};

const APP_STORAGE_VERSION: u8 = 1;
const MAX_BACKGROUND_BYTES: usize = 20 * 1024 * 1024;
const MAX_PREFERENCE_BYTES: usize = 1024 * 1024;
const MAX_TOTAL_PREFERENCE_BYTES: usize = 8 * 1024 * 1024;
static STORAGE_LOCK: Mutex<()> = Mutex::const_new(());

#[derive(Debug, Error)]
pub enum AppStorageError {
    #[error("invalid app storage data")]
    InvalidData,
    #[error(transparent)]
    Io(#[from] io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomBackgroundInput {
    pub bytes: Vec<u8>,
    pub created_at: u64,
    pub id: String,
    pub media_type: String,
    pub name: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomBackgroundMetadata {
    pub created_at: u64,
    pub id: String,
    pub media_type: String,
    pub name: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppStorageFile {
    preferences: BTreeMap<String, String>,
    version: u8,
}

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct BackgroundIndex {
    images: Vec<CustomBackgroundMetadata>,
    version: u8,
}

pub async fn initialize_storage(
    app_data: &Path,
    legacy_preferences: BTreeMap<String, String>,
    legacy_backgrounds: Vec<CustomBackgroundInput>,
) -> Result<BTreeMap<String, String>, AppStorageError> {
    let _guard = STORAGE_LOCK.lock().await;
    if let Some(storage) = read_storage_file(app_data).await? {
        return Ok(storage.preferences);
    }
    validate_preferences(&legacy_preferences)?;
    fs::create_dir_all(app_data).await?;
    update_backgrounds_unlocked(app_data, &[], legacy_backgrounds).await?;
    let storage = AppStorageFile {
        preferences: legacy_preferences,
        version: APP_STORAGE_VERSION,
    };
    write_json_atomic(&storage_path(app_data), &storage).await?;
    Ok(storage.preferences)
}

pub async fn read_preferences(
    app_data: &Path,
) -> Result<BTreeMap<String, String>, AppStorageError> {
    let _guard = STORAGE_LOCK.lock().await;
    Ok(read_storage_file(app_data)
        .await?
        .map(|storage| storage.preferences)
        .unwrap_or_default())
}

pub async fn update_preferences(
    app_data: &Path,
    updates: BTreeMap<String, Option<String>>,
) -> Result<(), AppStorageError> {
    let _guard = STORAGE_LOCK.lock().await;
    for (key, value) in &updates {
        validate_preference(key, value.as_deref().unwrap_or_default())?;
    }
    let mut storage = read_storage_file(app_data)
        .await?
        .unwrap_or(AppStorageFile {
            preferences: BTreeMap::new(),
            version: APP_STORAGE_VERSION,
        });
    for (key, value) in updates {
        match value {
            Some(value) => {
                storage.preferences.insert(key, value);
            }
            None => {
                storage.preferences.remove(&key);
            }
        }
    }
    validate_preferences(&storage.preferences)?;
    fs::create_dir_all(app_data).await?;
    write_json_atomic(&storage_path(app_data), &storage).await
}

pub fn validate_preference_updates(
    updates: &BTreeMap<String, Option<String>>,
) -> Result<(), AppStorageError> {
    for (key, value) in updates {
        validate_preference(key, value.as_deref().unwrap_or_default())?;
    }
    Ok(())
}

pub async fn list_custom_backgrounds(
    app_data: &Path,
) -> Result<Vec<CustomBackgroundMetadata>, AppStorageError> {
    let _guard = STORAGE_LOCK.lock().await;
    Ok(read_background_index(app_data).await?.images)
}

pub async fn read_custom_background(app_data: &Path, id: &str) -> Result<Vec<u8>, AppStorageError> {
    let _guard = STORAGE_LOCK.lock().await;
    validate_identifier(id)?;
    let index = read_background_index(app_data).await?;
    if !index.images.iter().any(|image| image.id == id) {
        return Err(AppStorageError::InvalidData);
    }
    let bytes = fs::read(background_file_path(app_data, id)).await?;
    validate_image_bytes(&bytes)?;
    Ok(bytes)
}

pub fn custom_background_asset_path(app_data: &Path, id: &str) -> Result<PathBuf, AppStorageError> {
    validate_identifier(id)?;
    Ok(background_file_path(app_data, id))
}

pub async fn update_custom_backgrounds(
    app_data: &Path,
    deleted_ids: &[String],
    images: Vec<CustomBackgroundInput>,
) -> Result<(), AppStorageError> {
    let _guard = STORAGE_LOCK.lock().await;
    update_backgrounds_unlocked(app_data, deleted_ids, images).await
}

async fn update_backgrounds_unlocked(
    app_data: &Path,
    deleted_ids: &[String],
    images: Vec<CustomBackgroundInput>,
) -> Result<(), AppStorageError> {
    for id in deleted_ids {
        validate_identifier(id)?;
    }
    for image in &images {
        validate_background(image)?;
    }
    let root = background_root(app_data);
    fs::create_dir_all(&root).await?;
    let mut index = read_background_index(app_data).await?;
    index
        .images
        .retain(|image| !deleted_ids.contains(&image.id));
    for image in images {
        write_bytes_atomic(&background_file_path(app_data, &image.id), image.bytes).await?;
        index.images.retain(|stored| stored.id != image.id);
        index.images.push(CustomBackgroundMetadata {
            created_at: image.created_at,
            id: image.id,
            media_type: image.media_type,
            name: image.name,
        });
    }
    index.images.sort_by_key(|image| image.created_at);
    index.version = APP_STORAGE_VERSION;
    write_json_atomic(&background_index_path(app_data), &index).await?;
    for id in deleted_ids {
        match fs::remove_file(background_file_path(app_data, id)).await {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
    }
    Ok(())
}

async fn read_storage_file(app_data: &Path) -> Result<Option<AppStorageFile>, AppStorageError> {
    let bytes = match fs::read(storage_path(app_data)).await {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    let storage: AppStorageFile = serde_json::from_slice(&bytes)?;
    if storage.version != APP_STORAGE_VERSION {
        return Err(AppStorageError::InvalidData);
    }
    validate_preferences(&storage.preferences)?;
    Ok(Some(storage))
}

async fn read_background_index(app_data: &Path) -> Result<BackgroundIndex, AppStorageError> {
    let bytes = match fs::read(background_index_path(app_data)).await {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return Ok(BackgroundIndex::default());
        }
        Err(error) => return Err(error.into()),
    };
    let index: BackgroundIndex = serde_json::from_slice(&bytes)?;
    if index.version != APP_STORAGE_VERSION {
        return Err(AppStorageError::InvalidData);
    }
    for image in &index.images {
        validate_metadata(image)?;
    }
    Ok(index)
}

fn validate_preferences(preferences: &BTreeMap<String, String>) -> Result<(), AppStorageError> {
    let mut total = 0_usize;
    for (key, value) in preferences {
        validate_preference(key, value)?;
        total = total.saturating_add(key.len()).saturating_add(value.len());
    }
    (total <= MAX_TOTAL_PREFERENCE_BYTES)
        .then_some(())
        .ok_or(AppStorageError::InvalidData)
}

fn validate_preference(key: &str, value: &str) -> Result<(), AppStorageError> {
    let valid_key = (key.starts_with("codeagent.") || key.starts_with("codeagent:"))
        && key.len() <= 512
        && !key.contains(['\0', '\r', '\n']);
    (valid_key && value.len() <= MAX_PREFERENCE_BYTES)
        .then_some(())
        .ok_or(AppStorageError::InvalidData)
}

fn validate_background(image: &CustomBackgroundInput) -> Result<(), AppStorageError> {
    validate_metadata(&CustomBackgroundMetadata {
        created_at: image.created_at,
        id: image.id.clone(),
        media_type: image.media_type.clone(),
        name: image.name.clone(),
    })?;
    validate_image_bytes(&image.bytes)?;
    image_type_matches(&image.media_type, &image.bytes)
        .then_some(())
        .ok_or(AppStorageError::InvalidData)
}

fn validate_metadata(image: &CustomBackgroundMetadata) -> Result<(), AppStorageError> {
    validate_identifier(&image.id)?;
    let valid_type = matches!(
        image.media_type.as_str(),
        "image/gif" | "image/jpeg" | "image/png" | "image/webp"
    );
    let valid_name = !image.name.is_empty()
        && image.name.len() <= 255
        && !image.name.contains(['/', '\\', '\0', '\r', '\n']);
    (valid_type && valid_name)
        .then_some(())
        .ok_or(AppStorageError::InvalidData)
}

fn validate_identifier(value: &str) -> Result<(), AppStorageError> {
    let valid = !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'));
    valid.then_some(()).ok_or(AppStorageError::InvalidData)
}

fn validate_image_bytes(bytes: &[u8]) -> Result<(), AppStorageError> {
    let valid = !bytes.is_empty()
        && bytes.len() <= MAX_BACKGROUND_BYTES
        && (bytes.starts_with(&[0x89, b'P', b'N', b'G', 13, 10, 26, 10])
            || bytes.starts_with(&[0xff, 0xd8, 0xff])
            || bytes.starts_with(b"GIF87a")
            || bytes.starts_with(b"GIF89a")
            || (bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP"));
    valid.then_some(()).ok_or(AppStorageError::InvalidData)
}

fn image_type_matches(media_type: &str, bytes: &[u8]) -> bool {
    match media_type {
        "image/png" => bytes.starts_with(&[0x89, b'P', b'N', b'G', 13, 10, 26, 10]),
        "image/jpeg" => bytes.starts_with(&[0xff, 0xd8, 0xff]),
        "image/gif" => bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a"),
        "image/webp" => bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP",
        _ => false,
    }
}

async fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> Result<(), AppStorageError> {
    super::atomic_file::write_bytes(path, serde_json::to_vec(value)?).await?;
    Ok(())
}

async fn write_bytes_atomic(path: &Path, bytes: Vec<u8>) -> Result<(), AppStorageError> {
    super::atomic_file::write_bytes(path, bytes).await?;
    Ok(())
}

fn storage_path(app_data: &Path) -> PathBuf {
    app_data.join("app.json")
}

fn background_root(app_data: &Path) -> PathBuf {
    app_data.join("backgrounds/custom")
}

fn background_index_path(app_data: &Path) -> PathBuf {
    background_root(app_data).join("index.json")
}

fn background_file_path(app_data: &Path, id: &str) -> PathBuf {
    background_root(app_data).join(format!("{id}.bin"))
}
