use super::error::AppError;
use crate::infrastructure::{
    app_storage,
    bing_wallpaper::{self, BingWallpaper, MAX_WALLPAPER_BYTES, is_jpeg, is_valid_day},
};
use serde::Serialize;
use std::{
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;
use tokio::{
    fs,
    io::{AsyncReadExt, AsyncWriteExt},
    sync::{Mutex, Semaphore, oneshot},
};

static DOWNLOAD_SLOTS: Semaphore = Semaphore::const_new(3);
static CACHE_WRITE_LOCK: Mutex<()> = Mutex::const_new(());
static STAGING_SEQUENCE: AtomicU64 = AtomicU64::new(1);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbenchBackgroundResponse {
    asset_path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase", tag = "status")]
pub enum DownloadWorkbenchBackgroundResponse {
    Cancelled,
    Saved { file_name: String },
}

#[tauri::command]
pub async fn list_workbench_backgrounds() -> Result<Vec<BingWallpaper>, AppError> {
    bing_wallpaper::list_wallpapers().await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn get_workbench_background(
    app: AppHandle,
    day: Option<String>,
    thumbnail: Option<bool>,
) -> Result<WorkbenchBackgroundResponse, AppError> {
    let asset = cached_wallpaper(&app, day.as_deref(), thumbnail.unwrap_or(false)).await?;
    app.asset_protocol_scope()
        .allow_file(&asset)
        .map_err(|_| AppError::WorkbenchBackgroundUnavailable)?;
    Ok(WorkbenchBackgroundResponse {
        asset_path: asset.to_string_lossy().into_owned(),
    })
}

async fn cached_wallpaper(
    app: &AppHandle,
    day: Option<&str>,
    thumbnail: bool,
) -> Result<PathBuf, AppError> {
    if day.is_some_and(|day| !is_valid_day(day)) {
        return Err(AppError::WorkbenchBackgroundUnavailable);
    }
    let root = app
        .path()
        .app_cache_dir()
        .map_err(|_| AppError::WorkbenchBackgroundUnavailable)?
        .join("workbench-background/bing-v2")
        .join(if thumbnail { "thumbnails" } else { "originals" });
    fs::create_dir_all(&root)
        .await
        .map_err(|_| AppError::WorkbenchBackgroundUnavailable)?;
    // 固定日期优先读取缓存，即使图片已移出 Bing 九日列表或当前离线也能继续使用。
    if let Some(day) = day
        && let Some(asset) =
            validated_cache_path(&root, &root.join(format!("bing-{day}.jpg"))).await
    {
        return Ok(asset);
    }
    let images = match bing_wallpaper::list_wallpapers().await {
        Ok(images) => images,
        Err(error) => {
            // 自动模式在离线重启时继续使用最近缓存，不因目录请求失败退回空白背景。
            if day.is_none()
                && let Some(asset) = latest_cached_wallpaper(&root).await
            {
                return Ok(asset);
            }
            return Err(error);
        }
    };
    let image = match day {
        Some(day) => images.iter().find(|image| image.day == day),
        None => images.first(),
    }
    .ok_or(AppError::WorkbenchBackgroundUnavailable)?;
    let destination = root.join(format!("bing-{}.jpg", image.day));
    if let Some(asset) = validated_cache_path(&root, &destination).await {
        return Ok(asset);
    }
    let _slot = DOWNLOAD_SLOTS
        .acquire()
        .await
        .map_err(|_| AppError::WorkbenchBackgroundUnavailable)?;
    let bytes = bing_wallpaper::fetch_image(image, thumbnail).await?;
    let _guard = CACHE_WRITE_LOCK.lock().await;
    if let Some(asset) = validated_cache_path(&root, &destination).await {
        return Ok(asset);
    }
    write_cache(&root, &destination, &bytes).await?;
    let pinned = pinned_day(app)
        .await
        .map(|day| root.join(format!("bing-{day}.jpg")));
    cleanup_old_cache_files(&root, pinned.as_deref().unwrap_or(&destination)).await;
    validated_cache_path(&root, &destination)
        .await
        .ok_or(AppError::WorkbenchBackgroundUnavailable)
}

async fn pinned_day(app: &AppHandle) -> Option<String> {
    let root = app.path().app_data_dir().ok()?;
    let preferences = app_storage::read_preferences(&root).await.ok()?;
    let value: serde_json::Value =
        serde_json::from_str(preferences.get("codeagent.workbench-background-preference")?).ok()?;
    value
        .get("selectedBingDay")?
        .as_str()
        .filter(|day| is_valid_day(day))
        .map(str::to_owned)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn download_workbench_background(
    app: AppHandle,
    day: String,
) -> Result<DownloadWorkbenchBackgroundResponse, AppError> {
    let source = cached_wallpaper(&app, Some(&day), false).await?;
    let file_name = format!("Bing-{day}.jpg");
    let (sender, receiver) = oneshot::channel();
    let mut dialog = app
        .dialog()
        .file()
        .add_filter("JPEG", &["jpg"])
        .set_file_name(&file_name);
    if let Some(window) = app.get_webview_window("main") {
        dialog = dialog.set_parent(&window);
    }
    dialog.save_file(move |path| {
        let _ = sender.send(path);
    });
    let Some(selected) = receiver
        .await
        .map_err(|_| AppError::WorkbenchBackgroundUnavailable)?
    else {
        return Ok(DownloadWorkbenchBackgroundResponse::Cancelled);
    };
    let mut destination = selected
        .into_path()
        .map_err(|_| AppError::WorkbenchBackgroundUnavailable)?;
    if destination.extension().is_none() {
        destination.set_extension("jpg");
    }
    // 目标路径只来自系统保存窗口，前端不能指定路径或任意远程 URL。
    fs::copy(source, &destination)
        .await
        .map_err(|_| AppError::WorkbenchBackgroundUnavailable)?;
    Ok(DownloadWorkbenchBackgroundResponse::Saved {
        file_name: destination
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or(&file_name)
            .to_owned(),
    })
}

async fn validated_cache_path(root: &Path, path: &Path) -> Option<PathBuf> {
    let metadata = fs::metadata(path).await.ok()?;
    if !metadata.is_file() || !(4..=MAX_WALLPAPER_BYTES as u64).contains(&metadata.len()) {
        return None;
    }
    let mut file = fs::File::open(path).await.ok()?;
    let mut signature = [0_u8; 3];
    file.read_exact(&mut signature).await.ok()?;
    if !is_jpeg(&signature) {
        return None;
    }
    let canonical_root = fs::canonicalize(root).await.ok()?;
    let canonical_path = fs::canonicalize(path).await.ok()?;
    canonical_path
        .starts_with(canonical_root)
        .then_some(canonical_path)
}

async fn write_cache(root: &Path, destination: &Path, bytes: &[u8]) -> Result<(), AppError> {
    // 先完整落盘并同步临时文件，再替换正式缓存，避免中断后留下半张图片。
    let staging = root.join(format!(
        ".bing.download-{}-{}",
        std::process::id(),
        STAGING_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ));
    let mut file = fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&staging)
        .await
        .map_err(|_| AppError::WorkbenchBackgroundUnavailable)?;
    if file.write_all(bytes).await.is_err() || file.sync_all().await.is_err() {
        let _ = fs::remove_file(&staging).await;
        return Err(AppError::WorkbenchBackgroundUnavailable);
    }
    drop(file);
    if destination.exists() {
        fs::remove_file(destination)
            .await
            .map_err(|_| AppError::WorkbenchBackgroundUnavailable)?;
    }
    if fs::rename(&staging, destination).await.is_err() {
        let _ = fs::remove_file(&staging).await;
        return Err(AppError::WorkbenchBackgroundUnavailable);
    }
    Ok(())
}

async fn cleanup_old_cache_files(root: &Path, current: &Path) {
    let Ok(mut entries) = fs::read_dir(root).await else {
        return;
    };
    let mut files = Vec::new();
    while let Ok(Some(entry)) = entries.next_entry().await {
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) == Some("jpg") {
            files.push(path);
        }
    }
    files.sort_by(|left, right| right.cmp(left));
    // 每种尺寸只保留最近九天与固定选择，避免预览图库时删除当前使用的历史壁纸。
    for path in files.into_iter().skip(9) {
        if path != current {
            let _ = fs::remove_file(path).await;
        }
    }
}

async fn latest_cached_wallpaper(root: &Path) -> Option<PathBuf> {
    let mut entries = fs::read_dir(root).await.ok()?;
    let mut files = Vec::new();
    while let Ok(Some(entry)) = entries.next_entry().await {
        let path = entry.path();
        if path
            .file_stem()
            .and_then(|name| name.to_str())
            .and_then(|name| name.strip_prefix("bing-"))
            .is_some_and(is_valid_day)
            && path.extension().and_then(|extension| extension.to_str()) == Some("jpg")
        {
            files.push(path);
        }
    }
    files.sort_by(|left, right| right.cmp(left));
    for path in files {
        if let Some(path) = validated_cache_path(root, &path).await {
            return Some(path);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    #[tokio::test]
    async fn offline_fallback_should_skip_corrupt_images_and_pick_latest_valid_day() {
        let root =
            std::env::temp_dir().join(format!("codeagent-bing-offline-{}", std::process::id()));
        tokio::fs::create_dir_all(&root).await.unwrap();
        tokio::fs::write(root.join("bing-2026-09-09.jpg"), b"invalid")
            .await
            .unwrap();
        let valid = root.join("bing-2026-09-08.jpg");
        tokio::fs::write(&valid, [0xff, 0xd8, 0xff, 0xd9])
            .await
            .unwrap();
        assert_eq!(
            super::latest_cached_wallpaper(&root).await,
            Some(tokio::fs::canonicalize(valid).await.unwrap())
        );
        tokio::fs::remove_dir_all(root).await.unwrap();
    }
    #[tokio::test]
    async fn history_cache_should_keep_recent_days_and_current_selection() {
        let root = std::env::temp_dir().join(format!("codeagent-bing-test-{}", std::process::id()));
        tokio::fs::create_dir_all(&root).await.unwrap();
        for day in 1..=12 {
            tokio::fs::write(
                root.join(format!("bing-2026-09-{day:02}.jpg")),
                [0xff, 0xd8, 0xff],
            )
            .await
            .unwrap();
        }
        let current = root.join("bing-2026-09-01.jpg");
        super::cleanup_old_cache_files(&root, &current).await;
        assert!(root.join("bing-2026-09-12.jpg").exists());
        assert!(current.exists());
        assert!(!root.join("bing-2026-09-02.jpg").exists());
        tokio::fs::remove_dir_all(root).await.unwrap();
    }

    #[test]
    fn cache_key_should_reject_invalid_dates_and_paths() {
        assert!(super::is_valid_day("2026-09-09"));
        assert!(!super::is_valid_day("2026-02-30"));
        assert!(!super::is_valid_day("../../escape"));
    }
}
