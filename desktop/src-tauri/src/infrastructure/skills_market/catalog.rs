use reqwest::Url;
use serde::Serialize;
use serde_json::Value;

const CLAWHUB_ORIGIN: &str = "https://clawhub.ai";
const CATALOG_PAGE_SIZE: &str = "24";

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClawhubSkillSummary {
    pub id: String,
    pub slug: String,
    pub owner: String,
    pub display_name: String,
    pub summary: String,
    pub latest_version: String,
    pub downloads: u64,
    pub stars: u64,
    pub version_count: u64,
    pub topics: Vec<String>,
    pub updated_at: i64,
    pub canonical_url: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClawhubSkillPage {
    pub items: Vec<ClawhubSkillSummary>,
    pub next_cursor: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClawhubSkillVersion {
    pub version: String,
    pub created_at: i64,
    pub changelog: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClawhubSkillDetail {
    #[serde(flatten)]
    pub summary: ClawhubSkillSummary,
    pub readme: String,
    pub changelog: String,
    pub scan_status: String,
    pub has_warnings: bool,
    pub versions: Vec<ClawhubSkillVersion>,
}

pub(crate) fn build_catalog_url(
    query: &str,
    cursor: Option<&str>,
    sort: &str,
) -> Result<Url, &'static str> {
    let query = query.trim();
    let path = if query.is_empty() {
        "/api/v1/packages"
    } else {
        "/api/v1/packages/search"
    };
    let mut url = Url::parse(CLAWHUB_ORIGIN)
        .and_then(|origin| origin.join(path))
        .map_err(|_| "invalid ClawHub URL")?;
    {
        let mut pairs = url.query_pairs_mut();
        pairs.append_pair("family", "skill");
        pairs.append_pair("limit", CATALOG_PAGE_SIZE);
        if query.is_empty() {
            let normalized_sort = match sort {
                "updated" | "downloads" => sort,
                _ => "recommended",
            };
            pairs.append_pair("sort", normalized_sort);
            if let Some(cursor) = cursor.filter(|value| !value.is_empty()) {
                pairs.append_pair("cursor", cursor);
            }
        } else {
            pairs.append_pair("q", &query.chars().take(120).collect::<String>());
        }
    }
    Ok(url)
}

pub(crate) fn parse_catalog_candidates(
    payload: Value,
    search: bool,
) -> Result<ClawhubSkillPage, &'static str> {
    let items = if search {
        payload
            .get("results")
            .and_then(Value::as_array)
            .ok_or("missing search results")?
            .iter()
            .filter_map(|entry| entry.get("package"))
            .filter_map(map_catalog_item)
            .collect()
    } else {
        payload
            .get("items")
            .and_then(Value::as_array)
            .ok_or("missing catalog items")?
            .iter()
            .filter_map(map_catalog_item)
            .collect()
    };
    let next_cursor = (!search)
        .then(|| {
            payload
                .get("nextCursor")
                .and_then(Value::as_str)
                .map(str::to_owned)
        })
        .flatten();
    Ok(ClawhubSkillPage { items, next_cursor })
}

fn map_catalog_item(item: &Value) -> Option<ClawhubSkillSummary> {
    if item.get("family")?.as_str()? != "skill" {
        return None;
    }
    let slug = item.get("name")?.as_str()?.trim();
    let owner = item.get("ownerHandle")?.as_str()?.trim();
    let latest_version = item.get("latestVersion")?.as_str()?.trim();
    if slug.is_empty() || owner.is_empty() || latest_version.is_empty() {
        return None;
    }
    let stats = item.get("stats");
    Some(ClawhubSkillSummary {
        id: format!("{owner}/{slug}"),
        slug: slug.to_owned(),
        owner: owner.to_owned(),
        display_name: item
            .get("displayName")
            .and_then(Value::as_str)
            .unwrap_or(slug)
            .to_owned(),
        summary: item
            .get("summary")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned(),
        latest_version: latest_version.to_owned(),
        downloads: stat_value(stats, "downloads"),
        stars: stat_value(stats, "stars"),
        version_count: stat_value(stats, "versions"),
        topics: item
            .get("topics")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .take(8)
            .map(str::to_owned)
            .collect(),
        updated_at: item
            .get("updatedAt")
            .and_then(Value::as_i64)
            .unwrap_or_default(),
        canonical_url: format!("{CLAWHUB_ORIGIN}/{owner}/skills/{slug}"),
    })
}

fn stat_value(stats: Option<&Value>, key: &str) -> u64 {
    stats
        .and_then(|value| value.get(key))
        .and_then(Value::as_u64)
        .unwrap_or_default()
}

pub(crate) fn parse_skill_detail(
    payload: Value,
    versions_payload: Value,
    scan_payload: Value,
) -> Result<ClawhubSkillDetail, &'static str> {
    let skill = payload
        .get("skill")
        .and_then(Value::as_object)
        .ok_or("missing skill detail")?;
    let owner = payload
        .pointer("/owner/handle")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or("missing skill owner")?;
    let latest_version = payload
        .pointer("/latestVersion/version")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or("missing latest skill version")?;
    let slug = skill
        .get("slug")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or("missing skill slug")?;
    let readme = skill
        .get("description")
        .and_then(Value::as_str)
        .ok_or("missing SKILL.md")?
        .to_owned();
    let stats = skill.get("stats");
    let summary = ClawhubSkillSummary {
        id: format!("{owner}/{slug}"),
        slug: slug.to_owned(),
        owner: owner.to_owned(),
        display_name: skill
            .get("displayName")
            .and_then(Value::as_str)
            .unwrap_or(slug)
            .to_owned(),
        summary: skill
            .get("summary")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned(),
        latest_version: latest_version.to_owned(),
        downloads: stat_value(stats, "downloads"),
        stars: stat_value(stats, "stars"),
        version_count: stat_value(stats, "versions"),
        topics: skill
            .get("topics")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .take(8)
            .map(str::to_owned)
            .collect(),
        updated_at: skill
            .get("updatedAt")
            .and_then(Value::as_i64)
            .unwrap_or_default(),
        canonical_url: format!("{CLAWHUB_ORIGIN}/{owner}/skills/{slug}"),
    };
    let versions = versions_payload
        .get("items")
        .and_then(Value::as_array)
        .ok_or("missing skill versions")?
        .iter()
        .filter_map(|item| {
            Some(ClawhubSkillVersion {
                version: item.get("version")?.as_str()?.to_owned(),
                created_at: item
                    .get("createdAt")
                    .and_then(Value::as_i64)
                    .unwrap_or_default(),
                changelog: item
                    .get("changelog")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_owned(),
            })
        })
        .take(20)
        .collect();
    Ok(ClawhubSkillDetail {
        summary,
        readme,
        changelog: payload
            .pointer("/latestVersion/changelog")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned(),
        scan_status: scan_payload
            .pointer("/security/status")
            .and_then(Value::as_str)
            .unwrap_or("not-run")
            .to_owned(),
        has_warnings: scan_payload
            .pointer("/security/hasWarnings")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        versions,
    })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{build_catalog_url, parse_catalog_candidates, parse_skill_detail};

    #[test]
    fn builds_bounded_skill_catalog_urls() {
        let browse = build_catalog_url("", Some("next page"), "downloads").unwrap();
        assert_eq!(browse.path(), "/api/v1/packages");
        assert_eq!(
            browse
                .query_pairs()
                .find(|(key, _)| key == "family")
                .unwrap()
                .1,
            "skill"
        );
        assert_eq!(
            browse
                .query_pairs()
                .find(|(key, _)| key == "limit")
                .unwrap()
                .1,
            "24"
        );
        assert_eq!(
            browse
                .query_pairs()
                .find(|(key, _)| key == "cursor")
                .unwrap()
                .1,
            "next page"
        );

        let search = build_catalog_url("rust tools", None, "recommended").unwrap();
        assert_eq!(search.path(), "/api/v1/packages/search");
        assert_eq!(
            search.query_pairs().find(|(key, _)| key == "q").unwrap().1,
            "rust tools"
        );
        assert_eq!(
            search
                .query_pairs()
                .find(|(key, _)| key == "family")
                .unwrap()
                .1,
            "skill"
        );
    }

    #[test]
    fn maps_only_owner_qualified_skill_packages() {
        let payload = json!({
            "items": [
                {
                    "name": "code-review",
                    "displayName": "Code Review",
                    "family": "skill",
                    "ownerHandle": "openclaw",
                    "latestVersion": "1.2.0",
                    "summary": "Review code changes.",
                    "stats": { "downloads": 120, "installs": 40, "stars": 8, "versions": 3 },
                    "topics": ["Review"],
                    "updatedAt": 1788400000000_i64
                },
                { "name": "missing-owner", "family": "skill", "ownerHandle": null },
                { "name": "plugin", "family": "code-plugin", "ownerHandle": "openclaw" }
            ],
            "nextCursor": "cursor-a"
        });

        let page = parse_catalog_candidates(payload, false).unwrap();
        assert_eq!(page.next_cursor.as_deref(), Some("cursor-a"));
        assert_eq!(page.items.len(), 1);
        assert_eq!(page.items[0].id, "openclaw/code-review");
        assert_eq!(
            page.items[0].canonical_url,
            "https://clawhub.ai/openclaw/skills/code-review"
        );
        assert_eq!(page.items[0].latest_version, "1.2.0");
    }

    #[test]
    fn maps_detail_versions_and_scan_status() {
        let detail = json!({
            "skill": {
                "slug": "code-review",
                "displayName": "Code Review",
                "summary": "Review code changes.",
                "description": "---\nname: code-review\ndescription: Review code changes.\n---\n\n# Code Review",
                "stats": { "downloads": 120, "stars": 8, "versions": 3 },
                "topics": ["Review"],
                "updatedAt": 1788400000000_i64
            },
            "latestVersion": { "version": "1.2.0", "changelog": "Improve checks" },
            "owner": { "handle": "openclaw" }
        });
        let versions = json!({
            "items": [
                { "version": "1.2.0", "createdAt": 1788400000000_i64, "changelog": "Improve checks" },
                { "version": "1.1.0", "createdAt": 1788300000000_i64, "changelog": "Add rules" }
            ]
        });
        let scan = json!({ "security": { "status": "clean", "hasWarnings": false } });

        let result = parse_skill_detail(detail, versions, scan).unwrap();
        assert_eq!(result.summary.id, "openclaw/code-review");
        assert_eq!(result.changelog, "Improve checks");
        assert_eq!(result.scan_status, "clean");
        assert!(!result.has_warnings);
        assert_eq!(result.versions.len(), 2);
        assert!(result.readme.contains("# Code Review"));
    }
}
