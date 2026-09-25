use super::{
    connection::ServerMessage,
    conversation_requests::{map_server_request, response_for_resolution},
};
use serde_json::{json, value::to_raw_value};

#[test]
fn approval_requests_should_map_and_encode_native_responses() {
    let mapped = map_server_request(
        ServerMessage {
            id: Some(9),
            method: "item/commandExecution/requestApproval".to_owned(),
            params: to_raw_value(&json!({
                "threadId": "thread-a", "turnId": "turn-a", "itemId": "item-a", "kind": "command",
                "startedAtMs": 1735689600000_i64, "command": "pnpm check", "cwd": "/work/a",
                "reason": "需要执行测试", "networkApprovalContext": null,
                "availableDecisions": ["accept", "acceptForSession", "decline"]
            }))
            .unwrap(),
        },
        5,
        "2025-01-01T00:00:00Z",
    )
    .expect("request should map")
    .expect("request should be supported");

    assert_eq!(mapped.event["type"], "pending_request.created");
    assert_eq!(mapped.pending.request["requestId"], "number:9");
    assert_eq!(mapped.pending.request["type"], "command_approval");
    assert_eq!(
        mapped.pending.request["availableDecisions"],
        json!(["allow", "allow_for_session", "deny"])
    );
    assert_eq!(
        response_for_resolution(&mapped.pending, &json!({"decision": "allow_for_session"}))
            .unwrap(),
        json!({"decision": "acceptForSession"})
    );

    let elicitation = map_server_request(
        ServerMessage {
            id: Some(10),
            method: "mcpServer/elicitation/request".to_owned(),
            params: to_raw_value(&json!({
                "threadId": "thread-a", "turnId": "turn-a", "serverName": "docs",
                "mode": "form", "message": "选择范围",
                "requestedSchema": {
                    "type": "object", "required": ["scope"],
                    "properties": {"scope": {"type": "string", "title": "范围", "enum": ["all", "current"]}}
                }
            }))
            .unwrap(),
        },
        6,
        "2025-01-01T00:00:00Z",
    )
    .unwrap()
    .unwrap();
    assert_eq!(elicitation.pending.request["type"], "mcp_elicitation");
    assert_eq!(elicitation.pending.request["fields"][0]["type"], "select");
    assert_eq!(elicitation.pending.request["fields"][0]["required"], true);
}
