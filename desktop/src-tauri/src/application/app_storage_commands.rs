use std::collections::BTreeMap;

use serde::Serialize;
use tauri::{AppHandle, Manager, State, ipc::Response};

use super::{app_storage_runtime::AppStorageRuntime, error::AppError};
use crate::infrastructure::app_storage::{self, CustomBackgroundInput, CustomBackgroundMetadata};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomBackgroundAsset {
    asset_path: String,
    created_at: u64,
    id: String,
    media_type: String,
    name: String,
}

#[tauri::command(rename_all = "camelCase")]
pub async fn initialize_app_storage(
    app: AppHandle,
    legacy_preferences: BTreeMap<String, String>,
    legacy_backgrounds: Vec<CustomBackgroundInput>,
) -> Result<BTreeMap<String, String>, AppError> {
    app_storage::initialize_storage(&app_data_dir(&app)?, legacy_preferences, legacy_backgrounds)
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn update_app_preferences(
    app: AppHandle,
    runtime: State<'_, AppStorageRuntime>,
    updates: BTreeMap<String, Option<String>>,
) -> Result<(), AppError> {
    app_storage::validate_preference_updates(&updates)
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    runtime.enqueue(app_data_dir(&app)?, updates).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn list_custom_backgrounds(
    app: AppHandle,
) -> Result<Vec<CustomBackgroundAsset>, AppError> {
    let app_data = app_data_dir(&app)?;
    let images = app_storage::list_custom_backgrounds(&app_data)
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    images
        .into_iter()
        .map(|image| authorize_custom_background_asset(&app, &app_data, image))
        .collect()
}

#[tauri::command(rename_all = "camelCase")]
pub async fn read_custom_background(app: AppHandle, id: String) -> Result<Response, AppError> {
    let bytes = app_storage::read_custom_background(&app_data_dir(&app)?, &id)
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    Ok(custom_background_response(bytes))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn update_custom_backgrounds(
    app: AppHandle,
    deleted_ids: Vec<String>,
    images: Vec<CustomBackgroundInput>,
) -> Result<(), AppError> {
    app_storage::update_custom_backgrounds(&app_data_dir(&app)?, &deleted_ids, images)
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)
}

fn app_data_dir(app: &AppHandle) -> Result<std::path::PathBuf, AppError> {
    app.path()
        .app_data_dir()
        .map_err(|_| AppError::FilesystemRequestFailed)
}

fn authorize_custom_background_asset(
    app: &AppHandle,
    app_data: &std::path::Path,
    image: CustomBackgroundMetadata,
) -> Result<CustomBackgroundAsset, AppError> {
    let asset_path = app_storage::custom_background_asset_path(app_data, &image.id)
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    // 仅动态授权索引内且标识符已校验的文件，避免扩大 asset protocol 的静态范围。
    app.asset_protocol_scope()
        .allow_file(&asset_path)
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    Ok(CustomBackgroundAsset {
        asset_path: asset_path.to_string_lossy().into_owned(),
        created_at: image.created_at,
        id: image.id,
        media_type: image.media_type,
        name: image.name,
    })
}

fn custom_background_response(bytes: Vec<u8>) -> Response {
    Response::new(bytes)
}

#[cfg(test)]
mod tests {
    use tauri::ipc::{InvokeResponseBody, IpcResponse};

    use super::custom_background_response;

    #[test]
    fn custom_background_should_use_raw_ipc_response() {
        let body = custom_background_response(vec![0x89, b'P', b'N', b'G'])
            .body()
            .unwrap();

        assert!(
            matches!(body, InvokeResponseBody::Raw(bytes) if bytes == [0x89, b'P', b'N', b'G'])
        );
    }
}
