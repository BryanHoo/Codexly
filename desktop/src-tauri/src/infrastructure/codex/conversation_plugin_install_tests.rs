use serde_json::json;
use serde_json::value::to_raw_value;

use super::{
    connection::ServerMessage,
    conversation_requests::{map_server_request, response_for_resolution},
};

#[test]
fn official_plugin_suggestion_should_map_and_persist_decline() {
    let suggestion = map_server_request(
        ServerMessage {
            id: Some(11),
            method: "mcpServer/elicitation/request".to_owned(),
            params: to_raw_value(&json!({
                "threadId": "thread-a", "turnId": "turn-a", "serverName": "codex_apps",
                "mode": "form", "message": "使用 GitHub 检索仓库",
                "requestedSchema": {"type": "object", "properties": {}},
                "_meta": {
                    "codex_approval_kind": "tool_suggestion", "persist": "always",
                    "tool_type": "plugin", "suggest_type": "install",
                    "suggest_reason": "使用 GitHub 检索仓库", "tool_id": "github@openai-curated-remote",
                    "tool_name": "GitHub", "suggestion_id": "request_plugin_install_call-a",
                    "remote_plugin_id": "plugins~Plugin_github", "app_connector_ids": ["connector_github"]
                }
            }))
            .unwrap(),
        },
        7,
        "2025-01-01T00:00:00Z",
    )
    .unwrap()
    .unwrap();

    assert_eq!(
        suggestion.pending.request["type"],
        "plugin_install_suggestion"
    );
    assert_eq!(suggestion.pending.request["pluginName"], "GitHub");
    assert_eq!(
        suggestion.pending.request["remotePluginId"],
        "plugins~Plugin_github"
    );
    assert_eq!(suggestion.pending.request["connectorCount"], 1);
    assert_eq!(
        response_for_resolution(
            &suggestion.pending,
            &json!({"action": "decline", "suppressFuture": true}),
        )
        .unwrap(),
        json!({"action": "decline", "_meta": {"persist": "always"}})
    );
}

#[test]
fn plugin_suggestion_without_remote_id_should_be_rejected() {
    let result = map_server_request(
        ServerMessage {
            id: Some(12),
            method: "mcpServer/elicitation/request".to_owned(),
            params: to_raw_value(&json!({
                "threadId": "thread-a", "turnId": "turn-a", "serverName": "codex_apps",
                "mode": "form", "message": "安装插件",
                "requestedSchema": {"type": "object", "properties": {}},
                "_meta": {
                    "codex_approval_kind": "tool_suggestion", "suggest_type": "install",
                    "tool_type": "plugin", "tool_id": "github@openai-curated-remote",
                    "tool_name": "GitHub", "suggest_reason": "读取仓库"
                }
            }))
            .unwrap(),
        },
        8,
        "2025-01-01T00:00:00Z",
    );

    assert!(result.is_err());
}
