use serde_json::value::to_raw_value;
use serde_json::{Value, json};

use super::{connection::ServerMessage, conversation_events::map_server_message};

#[test]
fn codex_152_errors_should_keep_public_classification() {
    let cases = [
        (json!("rateLimitExceeded"), "rate_limit_exceeded", None),
        (
            json!({"httpConnectionFailed": {"httpStatusCode": 429}}),
            "connection_failed",
            Some(429),
        ),
    ];

    for (codex_error_info, expected_code, expected_status) in cases {
        let event = map_server_message(
            ServerMessage {
                id: None,
                method: "error".to_owned(),
                params: to_raw_value(&json!({
                    "error": {
                        "codexErrorInfo": codex_error_info,
                        "message": "请求失败",
                    },
                    "threadId": "thread-a",
                    "turnId": "turn-a",
                    "willRetry": false,
                }))
                .unwrap(),
            },
            1,
            "2025-01-01T00:00:00Z",
        )
        .expect("Codex error should map")
        .expect("Codex error should stay visible");

        assert_eq!(event["payload"]["code"], expected_code);
        assert_eq!(
            event["payload"]
                .get("httpStatusCode")
                .and_then(Value::as_u64),
            expected_status
        );
    }
}
