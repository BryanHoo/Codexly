use std::{collections::HashSet, time::Duration};

use serde::Serialize;
use serde_json::{Map, Value, json};

use super::connection::{AppServerConnection, ConnectionError};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const PAGE_LIMIT: u32 = 100;
const MAX_CATALOG_ITEMS: usize = 10_000;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PageParams {
    cursor: Option<String>,
    limit: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SkillsParams<'a> {
    cwds: Vec<&'a str>,
    force_reload: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SkillConfigParams<'a> {
    path: &'a str,
    name: Option<&'a str>,
    enabled: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct McpParams {
    cursor: Option<String>,
    detail: &'static str,
    limit: u32,
    thread_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ConfigReadParams {
    include_layers: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ConfigValueWriteParams {
    expected_version: Option<String>,
    file_path: Option<String>,
    key_path: String,
    merge_strategy: &'static str,
    value: bool,
}

pub async fn list_models(connection: &AppServerConnection) -> Result<Value, ConnectionError> {
    connection
        .model_catalog
        .get_or_load(|| load_models(connection))
        .await
}

async fn load_models(connection: &AppServerConnection) -> Result<Value, ConnectionError> {
    let data = collect_pages(connection, "model/list", |cursor| PageParams {
        cursor: cursor.map(str::to_owned),
        limit: PAGE_LIMIT,
    })
    .await?;
    Ok(
        json!({"data": data.into_iter().filter_map(map_model).collect::<Vec<_>>(), "nextCursor": null}),
    )
}

pub async fn list_skills(
    connection: &AppServerConnection,
    cwd: &str,
    force_reload: bool,
) -> Result<Value, ConnectionError> {
    let skills = request_skills(connection, &[cwd], force_reload)
        .await?
        .into_iter()
        .filter(|(_, skill)| skill.get("enabled").and_then(Value::as_bool) != Some(false))
        .filter_map(|(_, skill)| map_skill(&skill))
        .take(MAX_CATALOG_ITEMS)
        .collect::<Vec<_>>();
    Ok(json!({"data": skills, "nextCursor": null}))
}

pub async fn list_installed_skills(
    connection: &AppServerConnection,
    cwds: &[&str],
    force_reload: bool,
) -> Result<Value, ConnectionError> {
    let skills = request_skills(connection, cwds, force_reload)
        .await?
        .into_iter()
        .filter_map(|(cwd, skill)| {
            let mut mapped = map_installed_skill(&skill)?;
            mapped.as_object_mut()?.insert("cwd".to_owned(), json!(cwd));
            Some(mapped)
        })
        .take(MAX_CATALOG_ITEMS)
        .collect::<Vec<_>>();
    Ok(json!({"data": skills, "nextCursor": null}))
}

pub async fn set_skill_enabled(
    connection: &AppServerConnection,
    path: &str,
    enabled: bool,
) -> Result<Value, ConnectionError> {
    connection
        .request(
            "skills/config/write",
            &SkillConfigParams {
                path,
                name: None,
                enabled,
            },
            REQUEST_TIMEOUT,
        )
        .await
}

pub async fn list_configured_mcp_servers(
    connection: &AppServerConnection,
) -> Result<Value, ConnectionError> {
    let response: Value = connection
        .request(
            "config/read",
            &ConfigReadParams {
                include_layers: false,
            },
            REQUEST_TIMEOUT,
        )
        .await?;
    let mut servers = response
        .pointer("/config/mcp_servers")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
        .filter_map(|(name, config)| {
            config.as_object().and_then(|config| {
                // 插件自带 MCP 由官方插件页统一管理，避免与用户配置重复展示和切换。
                if config.get("pluginId").is_some_and(|value| !value.is_null()) {
                    return None;
                }
                Some(json!({
                    "enabled": config.get("enabled").and_then(Value::as_bool).unwrap_or(true),
                    "name": name,
                }))
            })
        })
        .collect::<Vec<_>>();
    servers.sort_unstable_by(|left, right| left["name"].as_str().cmp(&right["name"].as_str()));
    Ok(json!({"data": servers}))
}

pub async fn set_mcp_server_enabled(
    connection: &AppServerConnection,
    name: &str,
    enabled: bool,
) -> Result<Value, ConnectionError> {
    let key_path = format!("mcp_servers.{}.enabled", quote_config_key_segment(name));
    let _: Value = connection
        .request(
            "config/value/write",
            &ConfigValueWriteParams {
                expected_version: None,
                file_path: None,
                key_path,
                merge_strategy: "replace",
                value: enabled,
            },
            REQUEST_TIMEOUT,
        )
        .await?;
    let _: Value = connection
        .request(
            "config/mcpServer/reload",
            &Map::<String, Value>::new(),
            REQUEST_TIMEOUT,
        )
        .await?;
    Ok(json!({"enabled": enabled}))
}

fn quote_config_key_segment(value: &str) -> String {
    let escaped = value.replace('\\', "\\\\").replace('"', "\\\"");
    format!("\"{escaped}\"")
}

async fn request_skills(
    connection: &AppServerConnection,
    cwds: &[&str],
    force_reload: bool,
) -> Result<Vec<(String, Value)>, ConnectionError> {
    let response: Value = connection
        .request(
            "skills/list",
            &SkillsParams {
                cwds: cwds.to_vec(),
                force_reload,
            },
            REQUEST_TIMEOUT,
        )
        .await?;
    Ok(response
        .get("data")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .flat_map(|entry| {
            let cwd = entry
                .get("cwd")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned();
            entry
                .get("skills")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .cloned()
                .map(move |skill| (cwd.clone(), skill))
        })
        .collect())
}

pub async fn list_mcp_servers(
    connection: &AppServerConnection,
    thread_id: &str,
) -> Result<Value, ConnectionError> {
    let items = collect_pages(connection, "mcpServerStatus/list", |cursor| McpParams {
        cursor: cursor.map(str::to_owned),
        detail: "toolsAndAuthOnly",
        limit: PAGE_LIMIT,
        thread_id: thread_id.to_owned(),
    })
    .await?;
    Ok(json!({"data": items.into_iter().filter_map(map_mcp_server).collect::<Vec<_>>() }))
}

pub async fn reload_mcp_servers(
    connection: &AppServerConnection,
    thread_id: &str,
) -> Result<Value, ConnectionError> {
    let _: Value = connection
        .request(
            "config/mcpServer/reload",
            &Map::<String, Value>::new(),
            REQUEST_TIMEOUT,
        )
        .await?;
    list_mcp_servers(connection, thread_id).await
}

async fn collect_pages<P, F>(
    connection: &AppServerConnection,
    method: &str,
    params: F,
) -> Result<Vec<Value>, ConnectionError>
where
    P: Serialize,
    F: Fn(Option<&str>) -> P,
{
    let mut data = Vec::new();
    let mut cursor: Option<String> = None;
    let mut seen = HashSet::new();
    loop {
        let response: Value = connection
            .request(method, &params(cursor.as_deref()), REQUEST_TIMEOUT)
            .await?;
        let page = response
            .get("data")
            .and_then(Value::as_array)
            .ok_or(ConnectionError::InvalidMessage)?;
        data.extend(page.iter().cloned());
        if data.len() > MAX_CATALOG_ITEMS {
            return Err(ConnectionError::InvalidMessage);
        }
        let Some(next) = response.get("nextCursor").and_then(Value::as_str) else {
            break;
        };
        if !seen.insert(next.to_owned()) {
            return Err(ConnectionError::InvalidMessage);
        }
        cursor = Some(next.to_owned());
    }
    Ok(data)
}

fn map_model(model: Value) -> Option<Value> {
    let id = model.get("id")?.as_str()?;
    let display_name = model.get("displayName")?.as_str()?;
    let mut efforts = model
        .get("supportedReasoningEfforts")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|effort| {
            Some(json!({
                "description": effort.get("description")?.as_str()?,
                "id": effort.get("reasoningEffort")?.as_str()?,
            }))
        })
        .collect::<Vec<_>>();
    // 第三方模型可能省略推理元数据；自定义 Provider 会在上层补齐可选档位。
    if efforts.is_empty() {
        efforts.push(json!({"description": "None", "id": "none"}));
    }
    Some(json!({
        "defaultReasoningEffort": model.get("defaultReasoningEffort").and_then(Value::as_str).unwrap_or("none"),
        "description": model.get("description").and_then(Value::as_str).unwrap_or_default(),
        "displayName": display_name,
        "id": id,
        "inputModalities": model
            .get("inputModalities")
            .cloned()
            .unwrap_or_else(|| json!(["text", "image"])),
        "isDefault": model.get("isDefault").and_then(Value::as_bool).unwrap_or(false),
        "supportedReasoningEfforts": efforts,
    }))
}

fn map_skill(skill: &Value) -> Option<Value> {
    let name = skill.get("name")?.as_str()?;
    let display_name = skill
        .pointer("/interface/displayName")
        .and_then(Value::as_str)
        .unwrap_or(name);
    Some(json!({
        "description": skill.get("description").and_then(Value::as_str).unwrap_or_default(),
        "displayName": display_name,
        "id": skill.get("path").and_then(Value::as_str).unwrap_or(name),
        "name": name,
        "scope": skill.get("scope").and_then(Value::as_str).unwrap_or("user"),
    }))
}

fn map_installed_skill(skill: &Value) -> Option<Value> {
    // 官方插件资产只在插件详情中只读展示，不进入独立 Skills 管理生命周期。
    if skill.get("pluginId").is_some_and(|value| !value.is_null()) {
        return None;
    }
    let path = skill.get("path")?.as_str()?;
    let name = skill.get("name")?.as_str()?;
    let display_name = skill
        .pointer("/interface/displayName")
        .and_then(Value::as_str)
        .unwrap_or(name);
    Some(json!({
        "description": skill.get("description").and_then(Value::as_str).unwrap_or_default(),
        "displayName": display_name,
        "enabled": skill.get("enabled").and_then(Value::as_bool).unwrap_or(true),
        "id": path,
        "name": name,
        "path": path,
        "scope": skill.get("scope").and_then(Value::as_str).unwrap_or("user"),
        "source": "local",
    }))
}

fn map_mcp_server(server: Value) -> Option<Value> {
    let name = server.get("name")?.as_str()?;
    let info = server.get("serverInfo").filter(|value| !value.is_null());
    // 线程连接态优先；无运行态但未登录时沿用官方的认证提示。
    let status = match server.get("runtimeStatus")? {
        Value::Null if server.get("authStatus").and_then(Value::as_str) == Some("notLoggedIn") => {
            "authenticationRequired"
        }
        Value::Null => "unknown",
        Value::String(value)
            if matches!(
                value.as_str(),
                "notStarted"
                    | "starting"
                    | "connected"
                    | "authenticationRequired"
                    | "failed"
                    | "cancelled"
                    | "disabled"
            ) =>
        {
            value
        }
        _ => return None,
    };
    // 154 将工具发现错误独立于连接态返回；只修正可用态，不覆盖认证和禁用态。
    // 仅投影已有状态字段，不把错误正文或完整工具目录传入 WebView。
    let status = if matches!(status, "connected" | "unknown")
        && server.get("toolsError").is_some_and(Value::is_string)
    {
        "failed"
    } else {
        status
    };
    let tool_count = server
        .get("tools")
        .and_then(Value::as_object)
        .map_or(0, Map::len);
    let display_name = info
        .and_then(|value| value.get("title"))
        .and_then(Value::as_str)
        .unwrap_or(name);
    Some(json!({
        "displayName": display_name,
        "name": name,
        "status": status,
        "toolCount": tool_count,
    }))
}
