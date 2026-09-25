use std::{sync::OnceLock, time::Duration};

use futures_util::StreamExt;
use reqwest::{Client, Response, header, redirect::Policy};
use semver::Version;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, ipc::Channel};
use tauri_plugin_updater::UpdaterExt;

use super::error::AppError;

pub(super) const CHANGELOG_URL: &str =
    "https://github.com/BryanHoo/Codexly/blob/main/desktop/CHANGELOG.md";
pub(super) const REPOSITORY_URL: &str = "https://github.com/BryanHoo/Codexly";

const INITIAL_VERSION: &str = "0.1.0";
const RELEASES_URL: &str = "https://api.github.com/repos/BryanHoo/Codexly/releases?per_page=1";
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_RESPONSE_BYTES: usize = 64 * 1024;
const MAX_RELEASE_NOTES_BYTES: usize = 32 * 1024;
const CHANGELOG: &str = include_str!("../../../CHANGELOG.md");
static HTTP_CLIENT: OnceLock<Client> = OnceLock::new();

#[derive(Debug)]
enum UpdateCheckError {
    ConnectionFailed,
    InvalidResponse,
}

impl From<reqwest::Error> for UpdateCheckError {
    fn from(error: reqwest::Error) -> Self {
        // 连接和正文读取都可能超时，保留网络失败类别供设置页准确提示。
        if error.is_timeout() || error.is_connect() {
            Self::ConnectionFailed
        } else {
            Self::InvalidResponse
        }
    }
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppUpdateInstallProgress {
    downloaded_bytes: u64,
    sequence: u64,
    total_bytes: Option<u64>,
}

#[derive(Debug, PartialEq)]
pub(super) struct AppUpdate {
    pub(super) latest_version: Option<String>,
    pub(super) release_notes: String,
    pub(super) release_notes_version: String,
    pub(super) status: &'static str,
    pub(super) update_available: bool,
}

#[derive(Deserialize)]
struct GitHubRelease {
    body: Option<String>,
    tag_name: String,
    #[serde(default)]
    assets: Vec<GitHubAsset>,
}

#[derive(Deserialize)]
struct GitHubAsset {
    name: String,
}

pub(super) async fn check_for_update(current_version: &str, app: &AppHandle) -> AppUpdate {
    let required_asset = app
        .config()
        .plugins
        .0
        .get("updater")
        .and_then(|config| config.get("endpoints"))
        .and_then(|endpoints| endpoints.get(0))
        .and_then(serde_json::Value::as_str)
        .and_then(|endpoint| endpoint.rsplit('/').next());
    let Some(required_asset) = required_asset else {
        return failed_update(current_version);
    };
    let response = match fetch_releases().await {
        Ok(response) => response,
        Err(error) => {
            let mut update = failed_update(current_version);
            if matches!(error, UpdateCheckError::ConnectionFailed) {
                update.status = "connection-failed";
            }
            return update;
        }
    };
    let update =
        resolve_release_response_for_channel(current_version, &response, Some(required_asset));
    if update.status != "check-failed" {
        return update;
    }
    let candidate = resolve_release_response_for_channel(current_version, &response, None);
    if candidate.status != "available" {
        return update;
    }

    // API 资产列表可能暂时为空；仅在此时用当前渠道的清单核实版本和可安装平台。
    let updater = match app.updater() {
        Ok(updater) => updater,
        Err(_) => return failed_update(current_version),
    };
    match updater.check().await {
        Ok(manifest) => confirm_release_with_manifest(
            current_version,
            candidate,
            manifest.as_ref().map(|update| update.version.as_str()),
        ),
        Err(_) => failed_update(current_version),
    }
}

pub(super) async fn install_update(
    app: &AppHandle,
    expected_version: &str,
    on_progress: Channel<AppUpdateInstallProgress>,
) -> Result<(), AppError> {
    let updater = app.updater().map_err(|_| AppError::AppUpdateCheckFailed)?;
    let update = updater
        .check()
        .await
        .map_err(|_| AppError::AppUpdateCheckFailed)?
        .filter(|update| update.version == expected_version)
        .ok_or(AppError::AppUpdateUnavailable)?;
    let mut downloaded_bytes = 0_u64;
    let mut sequence = 0_u64;
    update
        .download_and_install(
            move |chunk_bytes, total_bytes| {
                downloaded_bytes = downloaded_bytes.saturating_add(chunk_bytes as u64);
                sequence = sequence.saturating_add(1);
                // 设置页关闭不应中断安装，因此只忽略失效 Channel 的发送错误。
                let _ = on_progress.send(AppUpdateInstallProgress {
                    downloaded_bytes,
                    sequence,
                    total_bytes,
                });
            },
            || {},
        )
        .await
        .map_err(|_| AppError::AppUpdateInstallFailed)?;
    app.restart();
}

fn http_client() -> Result<&'static Client, UpdateCheckError> {
    if let Some(client) = HTTP_CLIENT.get() {
        return Ok(client);
    }
    let client = Client::builder()
        // 放宽慢网络的连接等待，同时用总超时限制整个响应读取过程。
        .connect_timeout(CONNECT_TIMEOUT)
        .redirect(Policy::none())
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(UpdateCheckError::from)?;
    let _ = HTTP_CLIENT.set(client);
    HTTP_CLIENT.get().ok_or(UpdateCheckError::InvalidResponse)
}

async fn fetch_releases() -> Result<Vec<u8>, UpdateCheckError> {
    // 更新检查只允许访问固定 GitHub API，并限制超时与响应体，避免拖慢应用启动。
    let response = http_client()?
        .get(RELEASES_URL)
        .header(header::ACCEPT, "application/vnd.github+json")
        .header(header::USER_AGENT, "CodeAgent-update-check")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await
        .map_err(UpdateCheckError::from)?;
    if !is_valid_response(&response) {
        return Err(UpdateCheckError::InvalidResponse);
    }
    read_bounded_body(response).await
}

fn is_valid_response(response: &Response) -> bool {
    response.status().is_success()
        && response.url().as_str() == RELEASES_URL
        && response
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .is_some_and(|value| value.to_ascii_lowercase().starts_with("application/json"))
}

async fn read_bounded_body(response: Response) -> Result<Vec<u8>, UpdateCheckError> {
    let mut bytes = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(UpdateCheckError::from)?;
        if bytes.len().saturating_add(chunk.len()) > MAX_RESPONSE_BYTES {
            return Err(UpdateCheckError::InvalidResponse);
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

fn resolve_release_response_for_channel(
    current_version: &str,
    body: &[u8],
    required_asset: Option<&str>,
) -> AppUpdate {
    let current = match Version::parse(current_version) {
        Ok(version) => version,
        Err(_) => return failed_update(current_version),
    };
    let releases = match serde_json::from_slice::<Vec<GitHubRelease>>(body) {
        Ok(releases) => releases,
        Err(_) => return failed_update(current_version),
    };
    let Some(release) = releases.first() else {
        // 0.1.0 发布前允许仓库尚无公开 release；后续版本缺失 release 必须显式报错。
        return if current_version == INITIAL_VERSION {
            current_update(current_version, None)
        } else {
            failed_update(current_version)
        };
    };
    if release
        .tag_name
        .strip_prefix('v')
        .and_then(|value| Version::parse(value).ok())
        .is_none()
    {
        return failed_update(current_version);
    }
    let Some(notes) = release.body.as_deref() else {
        return failed_update(current_version);
    };
    // 联合发布标签属于 Web，桌面版本从固定格式的发布元数据读取。
    let Some((metadata, display_notes)) = notes.split_once('\n') else {
        return failed_update(current_version);
    };
    let latest_version = match metadata
        .strip_prefix("<!-- codeagent-version: ")
        .and_then(|value| value.strip_suffix(" -->"))
        .and_then(|value| Version::parse(value).ok())
    {
        Some(version) => version,
        None => return failed_update(current_version),
    };
    if display_notes.trim().is_empty() {
        return failed_update(current_version);
    }
    let latest = latest_version.to_string();

    if latest_version > current {
        // 资产列表缺失时不能判定为最新；交由当前渠道的 updater 清单核实。
        if required_asset.is_some_and(|name| !release.assets.iter().any(|asset| asset.name == name))
        {
            return failed_update(current_version);
        }
        AppUpdate {
            latest_version: Some(latest.clone()),
            release_notes: truncate_notes(display_notes),
            release_notes_version: latest,
            status: "available",
            update_available: true,
        }
    } else if latest_version == current {
        AppUpdate {
            latest_version: Some(latest),
            release_notes: truncate_notes(display_notes),
            release_notes_version: current_version.to_owned(),
            status: "current",
            update_available: false,
        }
    } else {
        current_update(current_version, Some(latest))
    }
}

fn confirm_release_with_manifest(
    current_version: &str,
    candidate: AppUpdate,
    manifest_version: Option<&str>,
) -> AppUpdate {
    if candidate.status == "available" && candidate.latest_version.as_deref() == manifest_version {
        candidate
    } else {
        current_update(current_version, None)
    }
}

fn current_update(current_version: &str, latest_version: Option<String>) -> AppUpdate {
    AppUpdate {
        latest_version,
        release_notes: local_release_notes(current_version),
        release_notes_version: current_version.to_owned(),
        status: "current",
        update_available: false,
    }
}

fn failed_update(current_version: &str) -> AppUpdate {
    AppUpdate {
        latest_version: None,
        release_notes: local_release_notes(current_version),
        release_notes_version: current_version.to_owned(),
        status: "check-failed",
        update_available: false,
    }
}

fn local_release_notes(version: &str) -> String {
    // 内置当前版本日志，离线或 GitHub 不可用时仍可随时查看。
    let heading = format!("## [{version}] - ");
    let Some(start) = CHANGELOG.find(&heading) else {
        return format!("## [{version}]");
    };
    let section = &CHANGELOG[start..];
    let end = section.find("\n## [").unwrap_or(section.len());
    truncate_notes(section[..end].trim())
}

fn truncate_notes(notes: &str) -> String {
    if notes.len() <= MAX_RELEASE_NOTES_BYTES {
        return notes.trim().to_owned();
    }
    let mut end = MAX_RELEASE_NOTES_BYTES;
    while !notes.is_char_boundary(end) {
        end -= 1;
    }
    notes[..end].trim().to_owned()
}

#[cfg(test)]
mod tests {
    use super::{AppUpdate, confirm_release_with_manifest, resolve_release_response_for_channel};

    #[tokio::test]
    async fn stalled_response_body_should_report_connection_failure() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            // 确认客户端已发出请求，再模拟只返回部分正文的服务端。
            let mut request = [0; 1];
            socket.read_exact(&mut request).await.unwrap();
            socket
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\n[")
                .await
                .unwrap();
            std::future::pending::<()>().await;
        });
        let response = reqwest::Client::builder()
            .no_proxy()
            .timeout(std::time::Duration::from_secs(1))
            .build()
            .unwrap()
            .get(format!("http://{address}"))
            .send()
            .await
            .unwrap();
        let error = super::read_bounded_body(response).await.unwrap_err();
        server.abort();
        assert!(matches!(error, super::UpdateCheckError::ConnectionFailed));
    }

    #[test]
    fn newer_github_release_should_be_available_with_its_notes() {
        let update = resolve_release_response_for_channel(
            "0.1.0",
            br###"[{"tag_name":"v0.26.0","body":"<!-- codeagent-version: 0.2.0 -->\n## Added\n\n- New flow"}]"###,
            None,
        );

        assert_eq!(
            update,
            AppUpdate {
                latest_version: Some("0.2.0".to_owned()),
                release_notes: "## Added\n\n- New flow".to_owned(),
                release_notes_version: "0.2.0".to_owned(),
                status: "available",
                update_available: true,
            }
        );
    }

    #[test]
    fn matching_github_release_should_be_current() {
        let update = resolve_release_response_for_channel(
            "0.2.0",
            br#"[{"tag_name":"v0.26.0","body":"<!-- codeagent-version: 0.2.0 -->\nCurrent notes"}]"#,
            None,
        );

        assert_eq!(update.status, "current");
        assert!(!update.update_available);
        assert_eq!(update.release_notes_version, "0.2.0");
    }

    #[test]
    fn no_release_should_only_be_current_for_initial_version() {
        let initial = resolve_release_response_for_channel("0.1.0", b"[]", None);
        let later = resolve_release_response_for_channel("0.2.0", b"[]", None);

        assert_eq!(initial.status, "current");
        assert_eq!(initial.latest_version, None);
        assert_eq!(initial.release_notes_version, "0.1.0");
        assert_eq!(later.status, "check-failed");
    }

    #[test]
    fn legacy_should_not_offer_a_release_before_its_manifest_is_uploaded() {
        let body = br#"[{"tag_name":"v0.26.0","body":"<!-- codeagent-version: 0.2.0 -->\nNotes","assets":[{"name":"latest.json"}]}]"#;
        assert!(
            !super::resolve_release_response_for_channel("0.1.0", body, Some("latest-legacy.json"))
                .update_available
        );
        assert!(
            super::resolve_release_response_for_channel("0.1.0", body, Some("latest.json"))
                .update_available
        );
    }

    #[test]
    fn missing_api_assets_should_require_manifest_confirmation() {
        let update = resolve_release_response_for_channel(
            "0.2.3",
            br#"[{"tag_name":"v0.26.0","body":"<!-- codeagent-version: 0.2.4 -->\nNotes","assets":[]}]"#,
            Some("latest.json"),
        );

        assert_eq!(update.status, "check-failed");
    }

    #[test]
    fn matching_channel_manifest_should_offer_release_when_api_assets_are_missing() {
        let candidate = resolve_release_response_for_channel(
            "0.2.3",
            br#"[{"tag_name":"v0.26.0","body":"<!-- codeagent-version: 0.2.4 -->\nNotes","assets":[]}]"#,
            None,
        );

        let update = confirm_release_with_manifest("0.2.3", candidate, Some("0.2.4"));

        assert_eq!(update.status, "available");
        assert_eq!(update.latest_version.as_deref(), Some("0.2.4"));
    }

    #[test]
    fn older_channel_manifest_should_not_offer_uninstallable_release() {
        let candidate = resolve_release_response_for_channel(
            "0.2.3",
            br#"[{"tag_name":"v0.26.0","body":"<!-- codeagent-version: 0.2.4 -->\nNotes","assets":[]}]"#,
            None,
        );

        let update = confirm_release_with_manifest("0.2.3", candidate, Some("0.2.2"));

        assert_eq!(update.status, "current");
        assert!(!update.update_available);
    }
}
