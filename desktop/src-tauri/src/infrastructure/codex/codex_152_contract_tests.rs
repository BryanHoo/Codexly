use serde_json::json;
use serde_json::value::to_raw_value;

use super::{
    connection::ServerMessage, conversation_events::map_server_message,
    conversation_requests::map_server_request,
};

#[test]
fn auth_recovery_notifications_should_be_explicitly_ignored() {
    for method in [
        "modelProvider/authRecoveryStarted",
        "modelProvider/authRecoveryCompleted",
    ] {
        let event = map_server_message(
            ServerMessage {
                id: None,
                method: method.to_owned(),
                params: to_raw_value(&json!({
                    "threadId": "thread-a",
                    "turnId": "turn-a",
                    "provider": "openai",
                    "message": "Authentication recovery state changed."
                }))
                .unwrap(),
            },
            1,
            "2025-01-01T00:00:00Z",
        )
        .expect("notification should be valid");
        assert!(event.is_none());
    }

    let malformed = map_server_message(
        ServerMessage {
            id: None,
            method: "modelProvider/authRecoveryStarted".to_owned(),
            params: to_raw_value(&json!({
                "threadId": "thread-a",
                "turnId": "turn-a",
                "message": "Missing provider."
            }))
            .unwrap(),
        },
        2,
        "2025-01-01T00:00:00Z",
    );
    assert!(malformed.is_err());
}

#[test]
fn openai_form_should_downgrade_to_unsupported() {
    let request = map_server_request(
        ServerMessage {
            id: Some(11),
            method: "mcpServer/elicitation/request".to_owned(),
            params: to_raw_value(&json!({
                "threadId": "thread-a",
                "turnId": "turn-a",
                "serverName": "docs",
                "mode": "openaiForm",
                "message": "填写信息",
                "requestedSchema": {}
            }))
            .unwrap(),
        },
        7,
        "2025-01-01T00:00:00Z",
    )
    .expect("openaiForm request should map")
    .expect("openaiForm request should be supported as a downgrade");

    assert_eq!(request.pending.request["mode"], "unsupported");
    assert!(request.pending.request.get("fields").is_none());
}
