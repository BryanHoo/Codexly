use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager, State};
use tokio::{fs, io::AsyncWriteExt};

use crate::encoding::encode_lower_hex;

use super::pet_assets::scan_custom_pets;
use super::{error::AppError, state::AppState};

const CDN_ROOT: &str = "https://persistent.oaistatic.com/codex/pets/v1";
const MAX_ASSET_BYTES: usize = 4 * 1_024 * 1_024;
const SPRITESHEET_WIDTH: u32 = 1_536;
const SPRITESHEET_HEIGHT: u32 = 1_872;
static STAGING_SEQUENCE: AtomicU64 = AtomicU64::new(1);

struct BuiltinPet {
    file: &'static str,
    id: &'static str,
}

const BUILTIN_PETS: [BuiltinPet; 8] = [
    BuiltinPet {
        id: "codex",
        file: "codex-spritesheet-v4.webp",
    },
    BuiltinPet {
        id: "dewey",
        file: "dewey-spritesheet-v4.webp",
    },
    BuiltinPet {
        id: "fireball",
        file: "fireball-spritesheet-v4.webp",
    },
    BuiltinPet {
        id: "rocky",
        file: "rocky-spritesheet-v4.webp",
    },
    BuiltinPet {
        id: "seedy",
        file: "seedy-spritesheet-v4.webp",
    },
    BuiltinPet {
        id: "stacky",
        file: "stacky-spritesheet-v4.webp",
    },
    BuiltinPet {
        id: "bsod",
        file: "bsod-spritesheet-v4.webp",
    },
    BuiltinPet {
        id: "null-signal",
        file: "null-signal-spritesheet-v4.webp",
    },
];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PetAssetRecord {
    pub(super) asset_id: String,
    pub(super) asset_path: Option<String>,
    pub(super) availability: &'static str,
    pub(super) animations: Option<BTreeMap<String, CustomAnimationSpec>>,
    pub(super) description: Option<String>,
    pub(super) display_name: Option<String>,
    pub(super) frame: Option<PetFrame>,
    pub(super) id: String,
    pub(super) source: &'static str,
}

#[derive(Clone, Copy, Deserialize, Serialize)]
pub(super) struct PetFrame {
    pub(super) columns: usize,
    pub(super) height: u32,
    pub(super) rows: usize,
    pub(super) width: u32,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct CustomAnimationSpec {
    pub(super) fallback: Option<String>,
    pub(super) fps: Option<f64>,
    pub(super) frames: Vec<usize>,
    #[serde(rename = "loop")]
    pub(super) loops: Option<bool>,
}

#[derive(Serialize)]
pub struct PetCatalogResponse {
    data: Vec<PetAssetRecord>,
}

#[derive(Serialize)]
pub struct PetDownloadResponse {
    data: PetAssetRecord,
}

#[tauri::command]
pub async fn list_workbench_pets(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<PetCatalogResponse, AppError> {
    let codex_home = state.codex_home().await?;
    let mut data = Vec::with_capacity(BUILTIN_PETS.len());
    for pet in &BUILTIN_PETS {
        data.push(describe_pet(&codex_home, pet).await);
    }
    data.extend(scan_custom_pets(&codex_home).await);
    allow_asset_paths(&app, &data)?;
    Ok(PetCatalogResponse { data })
}

#[tauri::command(rename_all = "camelCase")]
pub async fn download_workbench_pet(
    app: AppHandle,
    pet_id: String,
    state: State<'_, AppState>,
) -> Result<PetDownloadResponse, AppError> {
    let pet = BUILTIN_PETS
        .iter()
        .find(|pet| pet.id == pet_id)
        .ok_or(AppError::PetAssetUnavailable)?;
    let codex_home = state.codex_home().await?;
    if describe_pet(&codex_home, pet).await.availability != "ready" {
        download_pet(&codex_home, pet).await?;
    }
    let data = describe_pet(&codex_home, pet).await;
    if data.availability != "ready" {
        return Err(AppError::PetAssetUnavailable);
    }
    allow_asset_paths(&app, std::slice::from_ref(&data))?;
    Ok(PetDownloadResponse { data })
}

fn allow_asset_paths(app: &AppHandle, records: &[PetAssetRecord]) -> Result<(), AppError> {
    for path in records
        .iter()
        .filter_map(|record| record.asset_path.as_deref())
    {
        app.asset_protocol_scope()
            .allow_file(path)
            .map_err(|_| AppError::PetAssetUnavailable)?;
    }
    Ok(())
}

async fn describe_pet(codex_home: &Path, pet: &'static BuiltinPet) -> PetAssetRecord {
    let path = pet_path(codex_home, pet);
    let asset_path = validated_asset_path(&path)
        .await
        .map(|path| path.to_string_lossy().into_owned());
    PetAssetRecord {
        asset_id: stable_asset_id(pet),
        animations: None,
        availability: if asset_path.is_some() {
            "ready"
        } else {
            "downloadable"
        },
        asset_path,
        description: None,
        display_name: None,
        frame: None,
        id: pet.id.to_owned(),
        source: "builtin",
    }
}

async fn download_pet(codex_home: &Path, pet: &'static BuiltinPet) -> Result<(), AppError> {
    let response = reqwest::Client::new()
        .get(format!("{CDN_ROOT}/{}", pet.file))
        .send()
        .await
        .map_err(|_| AppError::PetAssetUnavailable)?;
    if !response.status().is_success()
        || response.url().scheme() != "https"
        || response.url().host_str() != Some("persistent.oaistatic.com")
        || response
            .content_length()
            .is_some_and(|length| length > MAX_ASSET_BYTES as u64)
    {
        return Err(AppError::PetAssetUnavailable);
    }

    let mut bytes = Vec::with_capacity(
        response
            .content_length()
            .and_then(|length| usize::try_from(length).ok())
            .unwrap_or(256 * 1_024)
            .min(MAX_ASSET_BYTES),
    );
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| AppError::PetAssetUnavailable)?;
        if bytes.len() + chunk.len() > MAX_ASSET_BYTES {
            return Err(AppError::PetAssetUnavailable);
        }
        bytes.extend_from_slice(&chunk);
    }
    if webp_dimensions(&bytes) != Some((SPRITESHEET_WIDTH, SPRITESHEET_HEIGHT)) {
        return Err(AppError::PetAssetUnavailable);
    }

    let destination = pet_path(codex_home, pet);
    let parent = destination.parent().ok_or(AppError::PetAssetUnavailable)?;
    fs::create_dir_all(parent)
        .await
        .map_err(|_| AppError::PetAssetUnavailable)?;
    let staging = parent.join(format!(
        ".{}.download-{}-{}",
        pet.file,
        std::process::id(),
        STAGING_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ));
    let mut file = fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&staging)
        .await
        .map_err(|_| AppError::PetAssetUnavailable)?;
    if file.write_all(&bytes).await.is_err() || file.sync_all().await.is_err() {
        let _ = fs::remove_file(&staging).await;
        return Err(AppError::PetAssetUnavailable);
    }
    drop(file);
    if destination.exists() {
        fs::remove_file(&destination)
            .await
            .map_err(|_| AppError::PetAssetUnavailable)?;
    }
    if fs::rename(&staging, &destination).await.is_err() {
        let _ = fs::remove_file(&staging).await;
        return Err(AppError::PetAssetUnavailable);
    }
    Ok(())
}

async fn validated_asset_path(path: &Path) -> Option<PathBuf> {
    let metadata = fs::metadata(path).await.ok()?;
    if !metadata.is_file() || metadata.len() > MAX_ASSET_BYTES as u64 {
        return None;
    }
    let parent = fs::canonicalize(path.parent()?).await.ok()?;
    let canonical = fs::canonicalize(path).await.ok()?;
    if !canonical.starts_with(&parent) {
        return None;
    }
    let bytes = fs::read(&canonical).await.ok()?;
    (webp_dimensions(&bytes) == Some((SPRITESHEET_WIDTH, SPRITESHEET_HEIGHT))).then_some(canonical)
}

fn pet_path(codex_home: &Path, pet: &BuiltinPet) -> PathBuf {
    codex_home.join("cache/tui-pets/v1/assets").join(pet.file)
}

fn stable_asset_id(pet: &BuiltinPet) -> String {
    stable_asset_id_for(&format!("builtin:v1:{}:{}", pet.id, pet.file))
}

pub(super) fn stable_asset_id_for(value: &str) -> String {
    let mut hash = Sha256::new();
    hash.update(value);
    encode_lower_hex(hash.finalize())
}

pub(super) fn webp_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.get(0..4)? != b"RIFF" || bytes.get(8..12)? != b"WEBP" {
        return None;
    }
    let mut offset: usize = 12;
    while offset.checked_add(8)? <= bytes.len() {
        let kind = bytes.get(offset..offset + 4)?;
        let size = u32::from_le_bytes(bytes.get(offset + 4..offset + 8)?.try_into().ok()?) as usize;
        let data = bytes.get(offset + 8..offset.checked_add(8 + size)?)?;
        match kind {
            b"VP8X" if data.len() >= 10 => {
                return Some((read_u24(&data[4..7]) + 1, read_u24(&data[7..10]) + 1));
            }
            b"VP8 " if data.len() >= 10 && data[3..6] == [0x9d, 0x01, 0x2a] => {
                let width = u16::from_le_bytes([data[6], data[7]]) & 0x3fff;
                let height = u16::from_le_bytes([data[8], data[9]]) & 0x3fff;
                return Some((u32::from(width), u32::from(height)));
            }
            b"VP8L" if data.len() >= 5 && data[0] == 0x2f => {
                let bits = u32::from_le_bytes([data[1], data[2], data[3], data[4]]);
                return Some(((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1));
            }
            _ => {}
        }
        offset = offset.checked_add(8 + size + (size & 1))?;
    }
    None
}

fn read_u24(bytes: &[u8]) -> u32 {
    u32::from(bytes[0]) | (u32::from(bytes[1]) << 8) | (u32::from(bytes[2]) << 16)
}

#[cfg(test)]
mod tests {
    use super::webp_dimensions;

    #[test]
    fn webp_dimensions_should_parse_extended_header() {
        let mut bytes = b"RIFF\0\0\0\0WEBPVP8X\x0a\0\0\0".to_vec();
        bytes.extend_from_slice(&[0, 0, 0, 0, 0xff, 0x05, 0, 0x4f, 0x07, 0]);
        let riff_size = bytes.len() as u32 - 8;
        bytes[4..8].copy_from_slice(&riff_size.to_le_bytes());
        assert_eq!(webp_dimensions(&bytes), Some((1_536, 1_872)));
    }
}
