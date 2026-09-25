use std::{sync::OnceLock, time::Duration};

use futures_util::StreamExt;
use reqwest::{Client, StatusCode, Url, header::CONTENT_TYPE};
use serde_json::Value;

use super::{
    SkillsMarketError,
    catalog::{
        ClawhubSkillDetail, ClawhubSkillPage, build_catalog_url, parse_catalog_candidates,
        parse_skill_detail,
    },
    compatibility::is_codex_compatible_skill,
};

const JSON_LIMIT: usize = 512 * 1024;
const SKILL_MD_LIMIT: usize = 256 * 1024;
const ARCHIVE_LIMIT: usize = 50 * 1024 * 1024;
const CLAWHUB_ORIGIN: &str = "https://clawhub.ai";

pub struct DownloadedSkillArchive {
    pub bytes: Vec<u8>,
    pub content_hash: Option<String>,
    pub source_path: Option<String>,
}

fn http_client() -> Result<&'static Client, SkillsMarketError> {
    static CLIENT: OnceLock<Result<Client, reqwest::Error>> = OnceLock::new();
    CLIENT
        .get_or_init(|| {
            Client::builder()
                .connect_timeout(Duration::from_secs(5))
                .timeout(Duration::from_secs(18))
                .redirect(reqwest::redirect::Policy::limited(3))
                .user_agent("CodeAgent/0.1 Skills-Market")
                .build()
        })
        .as_ref()
        .map_err(|_| SkillsMarketError::Network)
}

async fn response_bytes(url: Url, limit: usize) -> Result<Vec<u8>, SkillsMarketError> {
    let response = http_client()?
        .get(url)
        .send()
        .await
        .map_err(|_| SkillsMarketError::Network)?;
    if response.status() == StatusCode::TOO_MANY_REQUESTS {
        return Err(SkillsMarketError::RateLimited);
    }
    if response.status() == StatusCode::NOT_FOUND {
        return Err(SkillsMarketError::NotFound);
    }
    if !response.status().is_success() {
        return Err(SkillsMarketError::Network);
    }
    bounded_response(response, limit).await
}

async fn bounded_response(
    response: reqwest::Response,
    limit: usize,
) -> Result<Vec<u8>, SkillsMarketError> {
    if response
        .content_length()
        .is_some_and(|size| size > limit as u64)
    {
        return Err(SkillsMarketError::InvalidResponse);
    }
    let mut bytes = Vec::new();
    let mut body = response.bytes_stream();
    while let Some(chunk) = body.next().await {
        let chunk = chunk.map_err(|_| SkillsMarketError::Network)?;
        if bytes.len().saturating_add(chunk.len()) > limit {
            return Err(SkillsMarketError::InvalidResponse);
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

async fn get_json(url: Url) -> Result<Value, SkillsMarketError> {
    serde_json::from_slice(&response_bytes(url, JSON_LIMIT).await?)
        .map_err(|_| SkillsMarketError::InvalidResponse)
}

fn skill_url(path: &str, owner: &str, slug: &str) -> Result<Url, SkillsMarketError> {
    if ![owner, slug].iter().all(|value| {
        !value.is_empty()
            && value.len() <= 100
            && value
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
    }) {
        return Err(SkillsMarketError::InvalidResponse);
    }
    let mut url = Url::parse(CLAWHUB_ORIGIN)
        .and_then(|origin| origin.join(path))
        .map_err(|_| SkillsMarketError::InvalidResponse)?;
    url.query_pairs_mut().append_pair("ownerHandle", owner);
    Ok(url)
}

async fn skill_markdown(owner: &str, slug: &str) -> Result<String, SkillsMarketError> {
    let path = format!("/api/v1/skills/{slug}/file");
    let mut url = skill_url(&path, owner, slug)?;
    url.query_pairs_mut()
        .append_pair("path", "SKILL.md")
        .append_pair("tag", "latest")
        .append_pair("preview", "1");
    let bytes = response_bytes(url, SKILL_MD_LIMIT).await?;
    if let Ok(payload) = serde_json::from_slice::<Value>(&bytes) {
        return payload
            .get("content")
            .and_then(Value::as_str)
            .or_else(|| payload.pointer("/file/content").and_then(Value::as_str))
            .map(str::to_owned)
            .ok_or(SkillsMarketError::InvalidResponse);
    }
    String::from_utf8(bytes).map_err(|_| SkillsMarketError::InvalidResponse)
}

pub async fn list_clawhub_skills(
    query: &str,
    cursor: Option<&str>,
    sort: &str,
) -> Result<ClawhubSkillPage, SkillsMarketError> {
    let url =
        build_catalog_url(query, cursor, sort).map_err(|_| SkillsMarketError::InvalidResponse)?;
    // 首屏只读取目录元数据；SKILL.md 的兼容性检查延迟到详情与安装阶段。
    parse_catalog_candidates(get_json(url).await?, !query.trim().is_empty())
        .map_err(|_| SkillsMarketError::InvalidResponse)
}

pub async fn get_clawhub_skill(
    owner: &str,
    slug: &str,
) -> Result<ClawhubSkillDetail, SkillsMarketError> {
    let detail_path = format!("/api/v1/skills/{slug}");
    let versions_path = format!("/api/v1/skills/{slug}/versions");
    let scan_path = format!("/api/v1/skills/{slug}/scan");
    let (detail, versions, scan, readme) = tokio::try_join!(
        get_json(skill_url(&detail_path, owner, slug)?),
        get_json(skill_url(&versions_path, owner, slug)?),
        get_json(skill_url(&scan_path, owner, slug)?),
        skill_markdown(owner, slug),
    )?;
    if !is_codex_compatible_skill(&readme) {
        return Err(SkillsMarketError::Incompatible);
    }
    let mut mapped = parse_skill_detail(detail, versions, scan)
        .map_err(|_| SkillsMarketError::InvalidResponse)?;
    mapped.readme = readme;
    Ok(mapped)
}

pub async fn download_skill_archive(
    owner: &str,
    slug: &str,
    version: &str,
) -> Result<DownloadedSkillArchive, SkillsMarketError> {
    let mut url = skill_url("/api/v1/download", owner, slug)?;
    url.query_pairs_mut()
        .append_pair("slug", slug)
        .append_pair("version", version);
    let response = http_client()?
        .get(url)
        .send()
        .await
        .map_err(|_| SkillsMarketError::Network)?;
    if !response.status().is_success() {
        return Err(if response.status() == StatusCode::NOT_FOUND {
            SkillsMarketError::NotFound
        } else {
            SkillsMarketError::Network
        });
    }
    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default()
        .to_owned();
    let bytes = bounded_response(response, ARCHIVE_LIMIT)
        .await
        .map_err(|error| match error {
            SkillsMarketError::Network => error,
            _ => SkillsMarketError::InvalidArchive,
        })?;
    if !content_type.contains("json") {
        return Ok(DownloadedSkillArchive {
            bytes,
            content_hash: None,
            source_path: None,
        });
    }
    let handoff: Value =
        serde_json::from_slice(&bytes).map_err(|_| SkillsMarketError::InvalidArchive)?;
    if handoff.get("sourceRef").and_then(Value::as_str) != Some("public-github") {
        return Err(SkillsMarketError::InvalidArchive);
    }
    let archive_url = handoff
        .get("archiveUrl")
        .and_then(Value::as_str)
        .and_then(|value| Url::parse(value).ok())
        .filter(|url| {
            url.scheme() == "https"
                && matches!(url.host_str(), Some("github.com" | "codeload.github.com"))
        })
        .ok_or(SkillsMarketError::InvalidArchive)?;
    let source_path = handoff
        .get("path")
        .and_then(Value::as_str)
        .filter(|path| !path.is_empty() && path.len() <= 512)
        .ok_or(SkillsMarketError::InvalidArchive)?;
    let content_hash = handoff
        .get("contentHash")
        .and_then(Value::as_str)
        .filter(|hash| hash.len() == 64 && hash.chars().all(|c| c.is_ascii_hexdigit()))
        .ok_or(SkillsMarketError::InvalidArchive)?;
    Ok(DownloadedSkillArchive {
        bytes: response_bytes(archive_url, ARCHIVE_LIMIT).await?,
        content_hash: Some(content_hash.to_ascii_lowercase()),
        source_path: Some(source_path.to_owned()),
    })
}
