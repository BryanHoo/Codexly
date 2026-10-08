use serde_json::value::to_raw_value;
use serde_json::{Value, json};

use super::{connection::ServerMessage, conversation_events::map_server_message};

#[test]
fn codex_152_errors_should_keep_public_classification() {
    let cases = [
        (json!("rateLimitExceeded"), "rate_limit_exceeded", None),
        (json!("flexUnavailable"), "flex_unavailable", None),
        (json!("tooManyDenials"), "too_many_denials", None),
        (json!("futureError"), "other", None),
        (json!({"futureError": {"detail": "unknown"}}), "other", None),
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

#[test]
fn guardian_interruption_should_preserve_errors_in_history_and_notifications() {
    let native = json!({
        "id": "turn-a", "status": "interrupted", "items": [],
        "error": {"message": "Guardian denial limit reached", "codexErrorInfo": "tooManyDenials"}
    });
    let turn =
        super::conversation::map_turn(serde_json::from_value(native.clone()).unwrap()).unwrap();
    assert_eq!(turn.status, "interrupted");
    assert_eq!(turn.error.as_deref(), Some("Guardian denial limit reached"));

    // 上游只发送中断终态；不能依赖额外 error 通知才能展示错误。
    let event = map_server_message(
        ServerMessage {
            id: None,
            method: "turn/completed".to_owned(),
            params: to_raw_value(&json!({"threadId": "thread-a", "turn": native})).unwrap(),
        },
        1,
        "2026-09-29T00:00:00Z",
    )
    .unwrap()
    .unwrap();
    assert_eq!(event["type"], "turn.completed");
    assert_eq!(event["payload"]["turn"]["status"], "interrupted");
    assert_eq!(
        event["payload"]["turn"]["error"],
        "Guardian denial limit reached"
    );
}
