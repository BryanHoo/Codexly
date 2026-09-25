use std::time::Duration;

use serde::Serialize;
use serde_json::{Value, json};

use super::connection::{AppServerConnection, ConnectionError};
use super::plugin_assets::{map_apps, map_plugin_skills};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const OFFICIAL_MARKETPLACES: [&str; 3] = [
    "openai-curated",
    "openai-api-curated",
    "openai-curated-remote",
];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PluginListParams {
    cwds: Option<Vec<String>>,
    force_refetch: bool,
    marketplace_kinds: Option<Vec<String>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RemotePluginParams<'a> {
    marketplace_path: Option<&'a str>,
    plugin_name: &'a str,
    remote_marketplace_name: Option<&'a str>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PluginInstallParams<'a> {
    install_attempt_id: Option<&'a str>,
    marketplace_path: Option<&'a str>,
    plugin_name: &'a str,
    remote_marketplace_name: Option<&'a str>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PluginUninstallParams<'a> {
    plugin_id: &'a str,
}

pub async fn list_official_plugins(
    connection: &AppServerConnection,
    cwds: Vec<String>,
    force_refetch: bool,
) -> Result<Value, ConnectionError> {
    let response: Value = connection
        .request(
            "plugin/list",
            &PluginListParams {
                cwds: Some(cwds),
                force_refetch,
                // 由 app-server 按认证模式选择本地官方目录或远程全局目录。
                marketplace_kinds: None,
            },
            REQUEST_TIMEOUT,
        )
        .await?;
    let mut data = Vec::new();
    for marketplace in response
        .get("marketplaces")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let Some(marketplace_name) = marketplace.get("name").and_then(Value::as_str) else {
            continue;
        };
        if !OFFICIAL_MARKETPLACES.contains(&marketplace_name) {
            continue;
        }
        let marketplace_path = marketplace.get("path").and_then(Value::as_str);
        data.extend(
            marketplace
                .get("plugins")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|plugin| {
                    map_plugin_summary(plugin, marketplace_name, marketplace_path)
                }),
        );
    }
    Ok(json!({"data": data}))
}

pub async fn get_official_plugin(
    connection: &AppServerConnection,
    marketplace_name: &str,
    marketplace_path: Option<&str>,
    plugin_name: &str,
) -> Result<Value, ConnectionError> {
    let response: Value = connection
        .request(
            "plugin/read",
            &RemotePluginParams {
                marketplace_path,
                plugin_name,
                remote_marketplace_name: marketplace_path.is_none().then_some(marketplace_name),
            },
            REQUEST_TIMEOUT,
        )
        .await?;
    let plugin = response
        .get("plugin")
        .ok_or(ConnectionError::InvalidMessage)?;
    map_plugin_detail(plugin).ok_or(ConnectionError::InvalidMessage)
}

pub async fn install_official_plugin(
    connection: &AppServerConnection,
    marketplace_name: &str,
    marketplace_path: Option<&str>,
    plugin_name: &str,
    install_attempt_id: Option<&str>,
) -> Result<Value, ConnectionError> {
    let response: Value = connection
        .request(
            "plugin/install",
            &PluginInstallParams {
                install_attempt_id,
                marketplace_path,
                plugin_name,
                remote_marketplace_name: marketplace_path.is_none().then_some(marketplace_name),
            },
            REQUEST_TIMEOUT,
        )
        .await?;
    let auth_policy = response
        .get("authPolicy")
        .and_then(Value::as_str)
        .ok_or(ConnectionError::InvalidMessage)?;
    Ok(json!({
        "appsNeedingAuth": map_apps(response.get("appsNeedingAuth")),
        "authPolicy": auth_policy,
    }))
}

pub async fn uninstall_official_plugin(
    connection: &AppServerConnection,
    plugin_id: &str,
) -> Result<Value, ConnectionError> {
    connection
        .request(
            "plugin/uninstall",
            &PluginUninstallParams { plugin_id },
            REQUEST_TIMEOUT,
        )
        .await
}

fn map_plugin_summary(
    plugin: &Value,
    marketplace_name: &str,
    marketplace_path: Option<&str>,
) -> Option<Value> {
    let name = plugin.get("name")?.as_str()?;
    let plugin_name = plugin
        .get("remotePluginId")
        .and_then(Value::as_str)
        .unwrap_or(name);
    let interface = plugin.get("interface").and_then(Value::as_object);
    Some(json!({
        "authPolicy": plugin.get("authPolicy")?.as_str()?,
        "availability": plugin.get("availability").and_then(Value::as_str).unwrap_or("AVAILABLE"),
        "description": interface.and_then(|value| value.get("shortDescription")).and_then(Value::as_str).unwrap_or_default(),
        "developerName": interface.and_then(|value| value.get("developerName")).cloned().unwrap_or(Value::Null),
        "disabledReason": plugin.get("disabledReason").cloned().unwrap_or(Value::Null),
        "displayName": interface.and_then(|value| value.get("displayName")).and_then(Value::as_str).unwrap_or(name),
        "enabled": plugin.get("enabled").and_then(Value::as_bool).unwrap_or(false),
        "id": plugin.get("id")?.as_str()?,
        "installPolicy": plugin.get("installPolicy")?.as_str()?,
        "installed": plugin.get("installed").and_then(Value::as_bool).unwrap_or(false),
        "localVersion": plugin.get("localVersion").cloned().unwrap_or(Value::Null),
        "logoUrl": interface.and_then(|value| value.get("logoUrl")).cloned().unwrap_or(Value::Null),
        "marketplaceName": marketplace_name,
        "marketplacePath": marketplace_path,
        "name": name,
        "pluginName": plugin_name,
        "version": plugin.get("version").cloned().unwrap_or(Value::Null),
    }))
}

fn map_plugin_detail(plugin: &Value) -> Option<Value> {
    let marketplace_name = plugin.get("marketplaceName")?.as_str()?;
    let marketplace_path = plugin.get("marketplacePath").and_then(Value::as_str);
    let mut summary =
        map_plugin_summary(plugin.get("summary")?, marketplace_name, marketplace_path)?;
    let description = plugin
        .get("description")
        .and_then(Value::as_str)
        .or_else(|| summary.get("description").and_then(Value::as_str))
        .unwrap_or_default()
        .to_owned();
    let fields = summary.as_object_mut()?;
    fields.insert("description".to_owned(), json!(description));
    fields.insert("skills".to_owned(), json!(map_plugin_skills(plugin)));
    fields.insert(
        "mcpServers".to_owned(),
        plugin
            .get("mcpServers")
            .cloned()
            .unwrap_or_else(|| json!([])),
    );
    fields.insert("apps".to_owned(), json!(map_apps(plugin.get("apps"))));
    fields.insert(
        "hooks".to_owned(),
        json!(
            plugin
                .get("hooks")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|hook| hook.get("key").and_then(Value::as_str))
                .collect::<Vec<_>>()
        ),
    );
    fields.insert(
        "websiteUrl".to_owned(),
        plugin
            .pointer("/summary/interface/websiteUrl")
            .cloned()
            .unwrap_or(Value::Null),
    );
    Some(summary)
}

#[cfg(test)]
mod tests {
    use serde_json::{Value, json};
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, duplex, split};

    use super::{
        AppServerConnection, get_official_plugin, install_official_plugin, list_official_plugins,
    };

    #[tokio::test]
    async fn official_plugins_should_use_remote_marketplace_contract() {
        let (client, server) = duplex(16 * 1024);
        let (client_reader, client_writer) = split(client);
        let (server_reader, mut server_writer) = split(server);
        let connection = AppServerConnection::new(client_reader, client_writer);
        let server_task = tokio::spawn(async move {
            let mut lines = BufReader::new(server_reader).lines();
            let list: Value =
                serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
            assert_eq!(list["method"], "plugin/list");
            assert_eq!(list["params"]["cwds"], json!(["/work"]));
            assert_eq!(list["params"]["forceRefetch"], true);
            assert_eq!(list["params"]["marketplaceKinds"], Value::Null);
            server_writer
                .write_all(
                    format!(
                        "{}\n",
                        json!({"id": list["id"].clone(), "result": {"marketplaces": [{
                            "name": "openai-curated-remote",
                            "plugins": [{
                                "id": "github@openai-curated-remote", "name": "github",
                                "remotePluginId": "plugins~Plugin_github", "authPolicy": "ON_INSTALL",
                                "installPolicy": "AVAILABLE", "source": {"type": "remote"},
                                "installed": false, "enabled": false,
                                "interface": {"displayName": "GitHub", "shortDescription": "Search repositories"}
                            }]
                        }, {
                            "name": "third-party",
                            "path": "/tmp/third-party.json",
                            "plugins": [{
                                "id": "local@test", "name": "local", "remotePluginId": "local",
                                "authPolicy": "NONE", "installPolicy": "AVAILABLE",
                                "source": {"type": "local"}
                            }]
                        }]}})
                    )
                    .as_bytes(),
                )
                .await
                .unwrap();

            let install: Value =
                serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
            assert_eq!(install["method"], "plugin/install");
            assert_eq!(install["params"]["marketplacePath"], Value::Null);
            assert_eq!(
                install["params"]["remoteMarketplaceName"],
                "openai-curated-remote"
            );
            assert_eq!(install["params"]["pluginName"], "plugins~Plugin_github");
            assert_eq!(
                install["params"]["installAttemptId"],
                "request_plugin_install_call-a"
            );
            server_writer
                .write_all(
                    format!(
                        "{}\n",
                        json!({"id": install["id"].clone(), "result": {
                            "authPolicy": "ON_INSTALL",
                            "appsNeedingAuth": [{
                                "id": "connector_github", "name": "GitHub",
                                "description": null, "installUrl": "https://example.test/install",
                                "category": "developer"
                            }]
                        }})
                    )
                    .as_bytes(),
                )
                .await
                .unwrap();
        });

        let plugins = list_official_plugins(&connection, vec!["/work".to_owned()], true)
            .await
            .unwrap();
        assert_eq!(plugins["data"].as_array().unwrap().len(), 1);
        assert_eq!(plugins["data"][0]["displayName"], "GitHub");

        let installed = install_official_plugin(
            &connection,
            "openai-curated-remote",
            None,
            "plugins~Plugin_github",
            Some("request_plugin_install_call-a"),
        )
        .await
        .unwrap();
        assert_eq!(installed["authPolicy"], "ON_INSTALL");
        assert_eq!(installed["appsNeedingAuth"][0]["description"], "");
        assert!(installed["appsNeedingAuth"][0].get("category").is_none());
        server_task.await.unwrap();
    }

    #[tokio::test]
    async fn official_plugins_should_include_local_openai_catalog() {
        let (client, server) = duplex(16 * 1024);
        let (client_reader, client_writer) = split(client);
        let (server_reader, mut server_writer) = split(server);
        let connection = AppServerConnection::new(client_reader, client_writer);
        let server_task = tokio::spawn(async move {
            let mut lines = BufReader::new(server_reader).lines();
            let list: Value =
                serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
            server_writer
                .write_all(
                    format!(
                        "{}\n",
                        json!({"id": list["id"].clone(), "result": {"marketplaces": [{
                            "name": "openai-api-curated",
                            "path": "/cache/api_marketplace.json",
                            "plugins": [{
                                "id": "game-studio@openai-api-curated", "name": "game-studio",
                                "remotePluginId": null, "authPolicy": "ON_USE",
                                "installPolicy": "AVAILABLE", "source": {"type": "local", "path": "/cache/game-studio"},
                                "installed": false, "enabled": false,
                                "interface": {"displayName": "Game Studio", "shortDescription": "Build games"}
                            }]
                        }]}})
                    )
                    .as_bytes(),
                )
                .await
                .unwrap();

            let read: Value =
                serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
            assert_eq!(read["method"], "plugin/read");
            assert_eq!(
                read["params"]["marketplacePath"],
                "/cache/api_marketplace.json"
            );
            assert_eq!(read["params"]["remoteMarketplaceName"], Value::Null);
            assert_eq!(read["params"]["pluginName"], "game-studio");
            server_writer
                .write_all(
                    format!(
                        "{}\n",
                        json!({"id": read["id"].clone(), "result": {"plugin": {
                            "marketplaceName": "openai-api-curated",
                            "marketplacePath": "/cache/api_marketplace.json",
                            "summary": {
                                "id": "game-studio@openai-api-curated", "name": "game-studio",
                                "remotePluginId": null, "authPolicy": "ON_USE",
                                "installPolicy": "AVAILABLE", "source": {"type": "local", "path": "/cache/game-studio"},
                                "installed": false, "enabled": false,
                                "interface": {"displayName": "Game Studio", "shortDescription": "Build games"}
                            },
                            "description": "Build polished games", "skills": [],
                            "onboardingSkill": {
                                "name": "game-studio-onboarding",
                                "shortDescription": "Set up Game Studio"
                            }, "mcpServers": [],
                            "apps": [], "hooks": []
                        }}})
                    )
                    .as_bytes(),
                )
                .await
                .unwrap();

            let install: Value =
                serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
            assert_eq!(install["method"], "plugin/install");
            assert_eq!(
                install["params"]["marketplacePath"],
                "/cache/api_marketplace.json"
            );
            assert_eq!(install["params"]["remoteMarketplaceName"], Value::Null);
            assert_eq!(install["params"]["pluginName"], "game-studio");
            server_writer
                .write_all(
                    format!(
                        "{}\n",
                        json!({"id": install["id"].clone(), "result": {
                            "authPolicy": "ON_USE", "appsNeedingAuth": []
                        }})
                    )
                    .as_bytes(),
                )
                .await
                .unwrap();
        });

        let plugins = list_official_plugins(&connection, vec!["/work".to_owned()], false)
            .await
            .unwrap();
        assert_eq!(plugins["data"].as_array().unwrap().len(), 1);
        assert_eq!(plugins["data"][0]["displayName"], "Game Studio");
        assert_eq!(
            plugins["data"][0]["marketplacePath"],
            "/cache/api_marketplace.json"
        );
        assert_eq!(plugins["data"][0]["pluginName"], "game-studio");
        let detail = get_official_plugin(
            &connection,
            "openai-api-curated",
            Some("/cache/api_marketplace.json"),
            "game-studio",
        )
        .await
        .unwrap();
        assert_eq!(detail["description"], "Build polished games");
        assert_eq!(detail["skills"].as_array().unwrap().len(), 1);
        assert_eq!(detail["skills"][0]["name"], "game-studio-onboarding");
        let installed = install_official_plugin(
            &connection,
            "openai-api-curated",
            Some("/cache/api_marketplace.json"),
            "game-studio",
            Some("attempt-local"),
        )
        .await
        .unwrap();
        assert_eq!(installed["authPolicy"], "ON_USE");
        server_task.await.unwrap();
    }
}
