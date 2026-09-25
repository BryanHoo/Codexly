use serde_json::json;
use serde_json::value::to_raw_value;

use super::{
    connection::ServerMessage,
    conversation_events::map_server_message,
    conversation_requests::{map_server_request, response_for_resolution},
};

#[test]
fn command_approval_kind_should_be_strict_and_write_stdin_should_map_structured_input() {
    let write_stdin = map_server_request(
        ServerMessage {
            id: Some(11),
            method: "item/commandExecution/requestApproval".to_owned(),
            params: to_raw_value(&json!({
                "approvalId": "approval-stdin-a", "availableDecisions": ["accept", "cancel"],
                "command": "write_stdin --session-id 42 'hello world'", "cwd": "/work/a",
                "itemId": "command-a", "kind": "writeStdin", "reason": "命令正在等待输入",
                "startedAtMs": 1735689600000_i64, "threadId": "thread-a", "turnId": "turn-a"
            }))
            .unwrap(),
        },
        7,
        "2025-01-01T00:00:00Z",
    )
    .expect("write stdin request should map")
    .expect("write stdin request should be supported");

    assert_eq!(
        write_stdin.pending.request["type"],
        "terminal_input_approval"
    );
    assert_eq!(
        write_stdin.pending.request["approvalId"],
        "approval-stdin-a"
    );
    assert_eq!(write_stdin.pending.request["processId"], "42");
    assert_eq!(write_stdin.pending.request["stdin"], "hello world");
    assert_eq!(write_stdin.pending.request["cwd"], "/work/a");
    assert_eq!(
        response_for_resolution(&write_stdin.pending, &json!({"decision": "deny"})).unwrap(),
        json!({"decision": "cancel"})
    );

    for params in invalid_command_approvals() {
        let result = map_server_request(
            ServerMessage {
                id: Some(12),
                method: "item/commandExecution/requestApproval".to_owned(),
                params: to_raw_value(&params).unwrap(),
            },
            8,
            "2025-01-01T00:00:00Z",
        );
        assert!(
            result.is_err(),
            "invalid approval kind or payload must fail"
        );
    }
}

#[test]
fn guardian_write_stdin_action_should_map_terminal_input_metadata() {
    let event = map_server_message(
        ServerMessage {
            id: None,
            method: "item/autoApprovalReview/started".to_owned(),
            params: to_raw_value(&json!({
                "action": {
                    "approvalId": "approval-stdin-a", "cwd": "/work/a", "processId": "42",
                    "stdin": "yes\n", "type": "writeStdin"
                },
                "review": {
                    "rationale": "输入仅确认已有命令", "riskLevel": "low",
                    "status": "inProgress", "userAuthorization": "medium"
                },
                "reviewId": "review-stdin-a", "startedAtMs": 1735689600000_i64,
                "targetItemId": "command-a", "threadId": "thread-a", "turnId": "turn-a"
            }))
            .unwrap(),
        },
        9,
        "2025-01-01T00:00:00Z",
    )
    .expect("guardian write stdin should map")
    .expect("guardian write stdin should be supported");

    let action = &event["payload"]["item"]["action"];
    assert_eq!(action["type"], "terminal_input");
    assert_eq!(action["approvalId"], "approval-stdin-a");
    assert_eq!(action["detail"], "yes\n");
    assert_eq!(action["processId"], "42");
    assert_eq!(action["cwd"], "/work/a");
}

fn invalid_command_approvals() -> [serde_json::Value; 3] {
    [
        json!({
            "availableDecisions": ["accept", "decline"], "command": "pwd", "cwd": "/work",
            "itemId": "command-a", "startedAtMs": 1735689600000_i64,
            "threadId": "thread-a", "turnId": "turn-a"
        }),
        json!({
            "availableDecisions": ["accept", "decline"], "command": "pwd", "cwd": "/work",
            "itemId": "command-a", "kind": "legacy", "startedAtMs": 1735689600000_i64,
            "threadId": "thread-a", "turnId": "turn-a"
        }),
        json!({
            "approvalId": "approval-stdin-a", "availableDecisions": ["accept", "cancel"],
            "command": "printf hello", "cwd": "/work", "itemId": "command-a",
            "kind": "writeStdin", "startedAtMs": 1735689600000_i64,
            "threadId": "thread-a", "turnId": "turn-a"
        }),
    ]
}
