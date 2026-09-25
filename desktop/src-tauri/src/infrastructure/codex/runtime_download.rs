use std::{path::Path, time::Duration};

use base64::{Engine, engine::general_purpose::STANDARD};
use futures_util::StreamExt;
use reqwest::{Client, Url, redirect::Policy};
use sha2::{Digest, Sha512};
use tokio::{fs, io::AsyncWriteExt};

use super::{
    runtime_download_progress::{DownloadProgressLimiter, DownloadProgressReporter},
    runtime_manager::{Distribution, RuntimeInstallError},
};
use crate::domain::runtime::CodexRuntimeInstallProgress;

const MAX_DOWNLOAD_BYTES: u64 = 192 * 1024 * 1024;
const MIRROR_TIMEOUT: Duration = Duration::from_secs(90);
const OFFICIAL_TIMEOUT: Duration = Duration::from_secs(15 * 60);

fn trusted_download_url(url: &Url) -> bool {
    url.scheme() == "https"
        && url.port_or_known_default() == Some(443)
        && url.username().is_empty()
        && url.password().is_none()
        && matches!(
            url.host_str(),
            Some("registry.npmmirror.com" | "cdn.npmmirror.com" | "registry.npmjs.org")
        )
}

fn download_redirect_policy() -> Policy {
    Policy::custom(|attempt| {
        // 镜像会跳转 CDN；仅允许固定 HTTPS 下载域名，限制跳转次数并拒绝降级。
        if attempt.previous().len() >= 3 || !trusted_download_url(attempt.url()) {
            attempt.error("untrusted or excessive runtime download redirect")
        } else {
            attempt.follow()
        }
    })
}

pub(super) async fn download_verified<OnProgress>(
    distribution: &Distribution,
    archive_path: &Path,
    progress: &mut DownloadProgressReporter<'_, OnProgress>,
) -> Result<(), RuntimeInstallError>
where
    OnProgress: Fn(CodexRuntimeInstallProgress) + Send + Sync,
{
    let client = Client::builder()
        .connect_timeout(Duration::from_secs(8))
        .read_timeout(Duration::from_secs(15))
        .redirect(download_redirect_policy())
        .build()?;
    download_from_sources(
        &client,
        [distribution.url, distribution.fallback_url],
        distribution.integrity,
        archive_path,
        progress,
    )
    .await
}

async fn download_from_sources<OnProgress>(
    client: &Client,
    urls: [&str; 2],
    integrity: &str,
    archive_path: &Path,
    progress: &mut DownloadProgressReporter<'_, OnProgress>,
) -> Result<(), RuntimeInstallError>
where
    OnProgress: Fn(CodexRuntimeInstallProgress) + Send + Sync,
{
    match download_source(
        client,
        urls[0],
        integrity,
        archive_path,
        progress,
        MIRROR_TIMEOUT,
    )
    .await
    {
        Ok(()) => Ok(()),
        // 本地写入失败与下载源无关；网络、大小或校验失败才回退一次官方源。
        Err(error @ RuntimeInstallError::Filesystem(_)) => Err(error),
        Err(_) => {
            download_source(
                client,
                urls[1],
                integrity,
                archive_path,
                progress,
                OFFICIAL_TIMEOUT,
            )
            .await
        }
    }
}

async fn download_source<OnProgress>(
    client: &Client,
    url: &str,
    integrity: &str,
    archive_path: &Path,
    progress: &mut DownloadProgressReporter<'_, OnProgress>,
    timeout: Duration,
) -> Result<(), RuntimeInstallError>
where
    OnProgress: Fn(CodexRuntimeInstallProgress) + Send + Sync,
{
    // 切源从零开始，截断临时文件；两个源始终校验同一个固定官方 SHA-512。
    progress.start_download(None);
    let response = client
        .get(url)
        .timeout(timeout)
        .send()
        .await?
        .error_for_status()?;
    let content_length = response.content_length();
    if content_length.is_some_and(|length| length > MAX_DOWNLOAD_BYTES) {
        return Err(RuntimeInstallError::DownloadTooLarge);
    }
    let total_bytes = content_length.filter(|length| *length > 0);
    progress.start_download(total_bytes);
    let mut file = fs::File::create(archive_path).await?;
    let mut stream = response.bytes_stream();
    let mut digest = Sha512::new();
    let mut downloaded = 0_u64;
    let mut limiter = DownloadProgressLimiter::new(total_bytes);
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        downloaded = downloaded.saturating_add(chunk.len() as u64);
        if downloaded > MAX_DOWNLOAD_BYTES {
            return Err(RuntimeInstallError::DownloadTooLarge);
        }
        digest.update(&chunk);
        file.write_all(&chunk).await?;
        if limiter.advance(downloaded) {
            progress.report_download(downloaded);
        }
    }
    if limiter.finish(downloaded) {
        progress.report_download(downloaded);
    }
    file.flush().await?;
    let expected = STANDARD
        .decode(integrity)
        .map_err(|_| RuntimeInstallError::Integrity)?;
    if digest.finalize().as_slice() != expected {
        return Err(RuntimeInstallError::Integrity);
    }
    Ok(())
}

#[cfg(test)]
#[path = "runtime_download_tests.rs"]
mod tests;
