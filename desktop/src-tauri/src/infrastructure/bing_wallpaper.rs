use std::{
    sync::OnceLock,
    time::{Duration, Instant},
};

use chrono::{Local, NaiveDate};
use futures_util::StreamExt;
use reqwest::{Client, Response, Url, header, redirect::Policy};
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

use crate::application::error::AppError;

const ORIGIN: &str = "https://www.bing.com";
pub const MAX_WALLPAPER_BYTES: usize = 20 * 1_024 * 1_024;
static HTTP_CLIENT: OnceLock<Client> = OnceLock::new();
static CATALOG: Mutex<Option<CachedCatalog>> = Mutex::const_new(None);

struct CachedCatalog {
    day: NaiveDate,
    loaded_at: Instant,
    images: Vec<BingWallpaper>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BingWallpaper {
    pub day: String,
    pub title: String,
    pub copyright: String,
    #[serde(skip)]
    pub image_base: String,
}

#[derive(Deserialize)]
struct Archive {
    images: Vec<ArchiveImage>,
}

#[derive(Deserialize)]
struct ArchiveImage {
    startdate: String,
    urlbase: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    copyright: String,
}

pub fn is_valid_day(day: &str) -> bool {
    day.len() == 10
        && NaiveDate::parse_from_str(day, "%Y-%m-%d")
            .is_ok_and(|date| date.format("%Y-%m-%d").to_string() == day)
}

fn parse_archive(bytes: &[u8]) -> Result<Vec<BingWallpaper>, AppError> {
    let archive: Archive =
        serde_json::from_slice(bytes).map_err(|_| AppError::WorkbenchBackgroundUnavailable)?;
    Ok(archive
        .images
        .into_iter()
        .filter_map(|image| {
            let date = NaiveDate::parse_from_str(&image.startdate, "%Y%m%d").ok()?;
            if image.startdate.len() != 8
                || !image.urlbase.starts_with("/th?id=OHR.")
                || image.urlbase.len() > 2048
            {
                return None;
            }
            let url = Url::parse(ORIGIN).ok()?.join(&image.urlbase).ok()?;
            if !is_bing_image_url(&url) || url.query_pairs().count() != 1 {
                return None;
            }
            Some(BingWallpaper {
                day: date.format("%Y-%m-%d").to_string(),
                title: image.title.chars().take(256).collect(),
                copyright: image.copyright.chars().take(1024).collect(),
                image_base: url.to_string(),
            })
        })
        .collect())
}

fn merge_archives(mut images: Vec<BingWallpaper>, older: Vec<BingWallpaper>) -> Vec<BingWallpaper> {
    images.extend(older);
    images.sort_by(|left, right| right.day.cmp(&left.day));
    images.dedup_by(|left, right| left.day == right.day);
    images.truncate(9);
    images
}

pub async fn list_wallpapers() -> Result<Vec<BingWallpaper>, AppError> {
    let mut cached = CATALOG.lock().await;
    let today = Local::now().date_naive();
    if let Some(catalog) = cached.as_ref()
        && catalog.day == today
        && catalog.loaded_at.elapsed() < Duration::from_secs(3600)
    {
        return Ok(catalog.images.clone());
    }
    // Bing 单次最多返回八张；第二页补齐第九天，并按真实日期去重，避免 idx 截断造成重复。
    let (recent, older) = tokio::join!(fetch_archive(0, 8), fetch_archive(7, 2));
    let images = merge_archives(recent?, older.unwrap_or_default());
    if images.is_empty() {
        return Err(AppError::WorkbenchBackgroundUnavailable);
    }
    *cached = Some(CachedCatalog {
        day: today,
        loaded_at: Instant::now(),
        images: images.clone(),
    });
    Ok(images)
}

fn http_client() -> Result<&'static Client, AppError> {
    if let Some(client) = HTTP_CLIENT.get() {
        return Ok(client);
    }
    let client = Client::builder()
        .redirect(Policy::none())
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|_| AppError::WorkbenchBackgroundUnavailable)?;
    let _ = HTTP_CLIENT.set(client);
    HTTP_CLIENT
        .get()
        .ok_or(AppError::WorkbenchBackgroundUnavailable)
}

async fn fetch_archive(index: u8, count: u8) -> Result<Vec<BingWallpaper>, AppError> {
    let url = format!("{ORIGIN}/HPImageArchive.aspx?format=js&idx={index}&n={count}&mkt=zh-CN");
    let response = http_client()?
        .get(&url)
        .header(header::ACCEPT, "application/json")
        .send()
        .await
        .map_err(|_| AppError::WorkbenchBackgroundUnavailable)?;
    if !response.status().is_success()
        || response.url().as_str() != url
        || !has_content_type(&response, "application/json")
    {
        return Err(AppError::WorkbenchBackgroundUnavailable);
    }
    parse_archive(&read_bounded_body(response, 64 * 1024).await?)
}

pub async fn fetch_image(image: &BingWallpaper, thumbnail: bool) -> Result<Vec<u8>, AppError> {
    // 并非每张壁纸都提供 480x270 文件，使用固定图片端点的缩放参数生成真实缩略图。
    let suffix = if thumbnail {
        "_1920x1080.jpg&w=480&h=270&c=7&rs=1"
    } else {
        "_UHD.jpg"
    };
    let url = format!("{}{suffix}", image.image_base);
    let response = http_client()?
        .get(url)
        .header(header::ACCEPT, "image/jpeg")
        .send()
        .await
        .map_err(|_| AppError::WorkbenchBackgroundUnavailable)?;
    if !response.status().is_success()
        || !is_bing_image_url(response.url())
        || !has_content_type(&response, "image/jpeg")
    {
        return Err(AppError::WorkbenchBackgroundUnavailable);
    }
    let bytes = read_bounded_body(
        response,
        if thumbnail {
            2 * 1024 * 1024
        } else {
            MAX_WALLPAPER_BYTES
        },
    )
    .await?;
    if !is_jpeg(&bytes) {
        return Err(AppError::WorkbenchBackgroundUnavailable);
    }
    Ok(bytes)
}

fn is_bing_image_url(url: &Url) -> bool {
    url.scheme() == "https"
        && url.host_str() == Some("www.bing.com")
        && url.port().is_none()
        && url.path() == "/th"
        && url.fragment().is_none()
        && url.username().is_empty()
        && url.password().is_none()
}

fn has_content_type(response: &Response, expected: &str) -> bool {
    response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.to_ascii_lowercase().starts_with(expected))
}

async fn read_bounded_body(response: Response, limit: usize) -> Result<Vec<u8>, AppError> {
    if response
        .content_length()
        .is_some_and(|length| length > limit as u64)
    {
        return Err(AppError::WorkbenchBackgroundUnavailable);
    }
    let mut bytes = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| AppError::WorkbenchBackgroundUnavailable)?;
        if bytes.len() + chunk.len() > limit {
            return Err(AppError::WorkbenchBackgroundUnavailable);
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

pub fn is_jpeg(bytes: &[u8]) -> bool {
    bytes.starts_with(&[0xff, 0xd8, 0xff])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn archive_should_reject_invalid_dates_and_foreign_image_endpoints() {
        let images = parse_archive(br#"{"images":[{"startdate":"20260909","urlbase":"/th?id=OHR.Test","title":"Test"},{"startdate":"20260230","urlbase":"/th?id=OHR.Invalid"},{"startdate":"20260908","urlbase":"https://evil.test/th?id=OHR.Invalid"}]}"#).unwrap();
        assert_eq!(images.len(), 1);
        assert_eq!(images[0].day, "2026-09-09");
    }

    #[test]
    fn archive_pages_should_return_nine_unique_days_in_descending_order() {
        let images: Vec<_> = (1..=12)
            .map(|day| BingWallpaper {
                day: format!("2026-09-{day:02}"),
                title: String::new(),
                copyright: String::new(),
                image_base: String::new(),
            })
            .collect();
        let merged = merge_archives(images.clone(), images);
        assert_eq!(merged.len(), 9);
        assert_eq!(merged.first().unwrap().day, "2026-09-12");
        assert_eq!(merged.last().unwrap().day, "2026-09-04");
    }

    #[tokio::test]
    #[ignore = "requires Bing network access"]
    async fn bing_should_fetch_real_history_thumbnail_and_original() {
        let images = list_wallpapers().await.unwrap();
        assert_eq!(images.len(), 9);
        for thumbnail in [true, false] {
            eprintln!("Downloading Bing image: thumbnail={thumbnail}");
            let bytes = fetch_image(images.last().unwrap(), thumbnail)
                .await
                .unwrap();
            assert!(is_jpeg(&bytes));
        }
    }
}
