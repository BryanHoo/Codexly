use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, duplex, split};

use super::{
    AppServerConnection, catalogs::list_models, list_configured_mcp_servers, list_installed_skills,
    list_mcp_servers, list_skills, set_mcp_server_enabled, set_skill_enabled,
};

#[tokio::test]
async fn catalogs_should_map_codex_protocol_without_losing_order() {
    let (client, server) = duplex(32 * 1024);
    let (client_reader, client_writer) = split(client);
    let (server_reader, mut server_writer) = split(server);
    let connection = AppServerConnection::new(client_reader, client_writer);

    let server_task = tokio::spawn(async move {
        let mut lines = BufReader::new(server_reader).lines();
        let fixtures = [
            (
                "model/list",
                json!({
                    "data": [{
                        "id": "gpt-test", "model": "gpt-test", "displayName": "GPT Test",
                        "description": "Test model", "hidden": false, "isDefault": true,
                        "inputModalities": ["text", "image", "audio"],
                        "defaultReasoningEffort": "medium",
                        "supportedReasoningEfforts": [
                            {"reasoningEffort": "low", "description": "Fast"},
                            {"reasoningEffort": "medium", "description": "Balanced"}
                        ]
                    }],
                    "nextCursor": null
                }),
            ),
            (
                "skills/list",
                json!({"data": [{"cwd": "/work", "skills": [
                    {"name": "review", "description": "Review code", "path": "/skills/review/SKILL.md", "scope": "repo", "enabled": true,
                     "interface": {"displayName": "Code Review", "iconSmallUrl": null, "iconLargeUrl": null}},
                    {"name": "disabled", "description": "Hidden", "path": "/skills/disabled/SKILL.md", "scope": "user", "enabled": false}
                ], "errors": []}]}),
            ),
            (
                "skills/list",
                json!({"data": [{"cwd": "/work", "skills": [
                    {"name": "review", "description": "Review code", "path": "/skills/review/SKILL.md", "scope": "repo", "enabled": true,
                     "interface": {"displayName": "Code Review", "iconSmallUrl": null, "iconLargeUrl": null}},
                    {"name": "disabled", "description": "Hidden", "path": "/skills/disabled/SKILL.md", "scope": "user", "enabled": false},
                    {"name": "plugin-owned", "description": "Bundled asset", "path": "/plugins/github/skills/search/SKILL.md", "scope": "user", "enabled": true,
                     "pluginId": "github@openai-curated-remote"}
                ], "errors": []}, {"cwd": "/other", "skills": [
                    {"name": "lint", "description": "Lint code", "path": "/other/.agents/skills/lint/SKILL.md", "scope": "repo", "enabled": true}
                ], "errors": []}]}),
            ),
            (
                "mcpServerStatus/list",
                json!({"data": [
                    {
                        "name": "docs", "pluginId": null, "runtimeStatus": "connected",
                        "serverInfo": {"name": "docs", "title": "Docs", "version": "1.2.0", "description": "Documentation", "icons": null, "websiteUrl": null},
                        "tools": {"search": {"name": "search"}}, "resources": [], "resourceTemplates": [], "authStatus": "oAuth"
                    },
                    {
                        "name": "login", "pluginId": null,
                        "runtimeStatus": "authenticationRequired", "serverInfo": null,
                        "tools": {}, "resources": [], "resourceTemplates": [], "authStatus": "notLoggedIn"
                    },
                    {
                        "name": "failed", "pluginId": null, "runtimeStatus": "failed",
                        "serverInfo": {"name": "failed"}, "tools": {}, "resources": [],
                        "resourceTemplates": [], "authStatus": "unknown"
                    },
                    {
                        "name": "disabled", "pluginId": null, "runtimeStatus": "disabled",
                        "serverInfo": null, "tools": {}, "resources": [],
                        "resourceTemplates": [], "authStatus": "unsupported"
                    },
                    {
                        "name": "not-started", "pluginId": null, "runtimeStatus": "notStarted",
                        "serverInfo": null, "tools": {}, "resources": [],
                        "resourceTemplates": [], "authStatus": "unknown"
                    },
                    {
                        "name": "starting", "pluginId": null, "runtimeStatus": "starting",
                        "serverInfo": null, "tools": {}, "resources": [],
                        "resourceTemplates": [], "authStatus": "unknown"
                    },
                    {
                        "name": "cancelled", "pluginId": null, "runtimeStatus": "cancelled",
                        "serverInfo": null, "tools": {}, "resources": [],
                        "resourceTemplates": [], "authStatus": "unknown"
                    },
                    {
                        "name": "unavailable", "pluginId": null, "runtimeStatus": null,
                        "serverInfo": null, "tools": {}, "resources": [],
                        "resourceTemplates": [], "authStatus": "unknown"
                    }
                ], "nextCursor": null}),
            ),
        ];

        for (method, result) in fixtures {
            let request: Value =
                serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
            assert_eq!(request["method"], method);
            if method == "skills/list" {
                let expected = if result["data"]
                    .as_array()
                    .is_some_and(|data| data.len() == 2)
                {
                    json!(["/work", "/other"])
                } else {
                    json!(["/work"])
                };
                assert_eq!(request["params"]["cwds"], expected);
            }
            if method == "mcpServerStatus/list" {
                assert_eq!(request["params"]["threadId"], "thread-a");
                assert_eq!(request["params"]["detail"], "toolsAndAuthOnly");
            }
            server_writer
                .write_all(
                    format!(
                        "{}\n",
                        json!({"id": request["id"].clone(), "result": result})
                    )
                    .as_bytes(),
                )
                .await
                .unwrap();
        }
    });

    let models = list_models(&connection).await.unwrap();
    assert_eq!(
        models["data"][0]["supportedReasoningEfforts"][0]["id"],
        "low"
    );
    assert_eq!(
        models["data"][0]["inputModalities"],
        json!(["text", "image", "audio"])
    );
    let skills = list_skills(&connection, "/work", false).await.unwrap();
    assert_eq!(skills["data"].as_array().unwrap().len(), 1);
    assert_eq!(skills["data"][0]["displayName"], "Code Review");
    let installed = list_installed_skills(&connection, &["/work", "/other"], true)
        .await
        .unwrap();
    assert_eq!(installed["data"].as_array().unwrap().len(), 3);
    assert_eq!(installed["data"][1]["enabled"], false);
    assert_eq!(installed["data"][1]["path"], "/skills/disabled/SKILL.md");
    assert_eq!(installed["data"][1]["scope"], "user");
    assert_eq!(installed["data"][2]["cwd"], "/other");
    let servers = list_mcp_servers(&connection, "thread-a").await.unwrap();
    assert_eq!(
        servers["data"],
        json!([
            {"displayName": "Docs", "name": "docs", "status": "connected", "toolCount": 1},
            {"displayName": "login", "name": "login", "status": "authenticationRequired", "toolCount": 0},
            {"displayName": "failed", "name": "failed", "status": "failed", "toolCount": 0},
            {"displayName": "disabled", "name": "disabled", "status": "disabled", "toolCount": 0},
            {"displayName": "not-started", "name": "not-started", "status": "notStarted", "toolCount": 0},
            {"displayName": "starting", "name": "starting", "status": "starting", "toolCount": 0},
            {"displayName": "cancelled", "name": "cancelled", "status": "cancelled", "toolCount": 0},
            {"displayName": "unavailable", "name": "unavailable", "status": "unknown", "toolCount": 0},
        ])
    );
    server_task.await.unwrap();
}

#[tokio::test]
async fn skill_toggle_should_use_the_official_path_selector() {
    let (client, server) = duplex(8 * 1024);
    let (client_reader, client_writer) = split(client);
    let (server_reader, mut server_writer) = split(server);
    let connection = AppServerConnection::new(client_reader, client_writer);
    let server_task = tokio::spawn(async move {
        let request: Value = serde_json::from_str(
            &BufReader::new(server_reader)
                .lines()
                .next_line()
                .await
                .unwrap()
                .unwrap(),
        )
        .unwrap();
        assert_eq!(request["method"], "skills/config/write");
        assert_eq!(request["params"]["path"], "/skills/review/SKILL.md");
        assert_eq!(request["params"]["name"], Value::Null);
        assert_eq!(request["params"]["enabled"], false);
        server_writer
            .write_all(
                format!(
                    "{}\n",
                    json!({"id": request["id"].clone(), "result": {"effectiveEnabled": false}})
                )
                .as_bytes(),
            )
            .await
            .unwrap();
    });

    let response = set_skill_enabled(&connection, "/skills/review/SKILL.md", false)
        .await
        .unwrap();
    assert_eq!(response["effectiveEnabled"], false);
    server_task.await.unwrap();
}

#[tokio::test]
async fn configured_mcp_servers_should_only_expose_name_and_enabled_state() {
    let (client, server) = duplex(8 * 1024);
    let (client_reader, client_writer) = split(client);
    let (server_reader, mut server_writer) = split(server);
    let connection = AppServerConnection::new(client_reader, client_writer);
    let server_task = tokio::spawn(async move {
        let request: Value = serde_json::from_str(
            &BufReader::new(server_reader)
                .lines()
                .next_line()
                .await
                .unwrap()
                .unwrap(),
        )
        .unwrap();
        assert_eq!(request["method"], "config/read");
        assert_eq!(request["params"], json!({"includeLayers": false}));
        server_writer
            .write_all(
                format!(
                    "{}\n",
                    json!({
                        "id": request["id"].clone(),
                        "result": {
                            "config": {"mcp_servers": {
                                "docs": {"command": "secret-command"},
                                "linear": {"enabled": false, "url": "https://example.test"},
                                "plugin-github": {"enabled": true, "pluginId": "github@openai-curated-remote"}
                            }},
                            "origins": {}
                        }
                    })
                )
                .as_bytes(),
            )
            .await
            .unwrap();
    });

    let response = list_configured_mcp_servers(&connection).await.unwrap();
    assert_eq!(
        response,
        json!({"data": [
            {"enabled": true, "name": "docs"},
            {"enabled": false, "name": "linear"}
        ]})
    );
    server_task.await.unwrap();
}

#[tokio::test]
async fn mcp_toggle_should_write_quoted_name_and_reload_runtime() {
    let (client, server) = duplex(8 * 1024);
    let (client_reader, client_writer) = split(client);
    let (server_reader, mut server_writer) = split(server);
    let connection = AppServerConnection::new(client_reader, client_writer);
    let server_task = tokio::spawn(async move {
        let mut lines = BufReader::new(server_reader).lines();
        let write: Value =
            serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
        assert_eq!(write["method"], "config/value/write");
        assert_eq!(
            write["params"]["keyPath"],
            "mcp_servers.\"docs.search\".enabled"
        );
        assert_eq!(write["params"]["value"], false);
        assert_eq!(write["params"]["mergeStrategy"], "replace");
        server_writer
            .write_all(
                format!(
                    "{}\n",
                    json!({"id": write["id"].clone(), "result": {
                        "filePath": "/home/user/.codex/config.toml",
                        "status": "ok",
                        "version": "2"
                    }})
                )
                .as_bytes(),
            )
            .await
            .unwrap();

        let reload: Value =
            serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
        assert_eq!(reload["method"], "config/mcpServer/reload");
        server_writer
            .write_all(
                format!("{}\n", json!({"id": reload["id"].clone(), "result": {}})).as_bytes(),
            )
            .await
            .unwrap();
    });

    let response = set_mcp_server_enabled(&connection, "docs.search", false)
        .await
        .unwrap();
    assert_eq!(response, json!({"enabled": false}));
    server_task.await.unwrap();
}
