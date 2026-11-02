use serde_json::{Value, json, value::to_raw_value};

use super::{NativeTurn, map_turn};
use crate::infrastructure::codex::{
    connection::ServerMessage, conversation_events::map_server_message,
};

#[test]
fn codex_166_item_timestamps_should_match_shared_contract() {
    let cases: Vec<Value> = serde_json::from_str(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/provider-codex/test/fixtures/codex-166-item-timings.json"
    )))
    .unwrap();
    for case in cases {
        let mut turn: NativeTurn = serde_json::from_value(case["turn"].clone()).unwrap();
        // 分页外层的旧计时由原生分页读取器附加，不属于上游 Turn 的反序列化字段。
        turn.item_timings = case["turn"].get("itemTimings").map(|value| {
            value
                .as_object()
                .unwrap()
                .iter()
                .map(|(id, timing)| {
                    (
                        id.clone(),
                        crate::domain::conversation::AgentItemTiming {
                            started_at_ms: timing["startedAtMs"].as_i64(),
                            completed_at_ms: timing["completedAtMs"].as_i64(),
                        },
                    )
                })
                .collect()
        });
        let result = map_turn(turn);
        if case["invalid"] == true {
            assert!(result.is_err(), "{}", case["name"]);
        } else {
            let turn = serde_json::to_value(result.unwrap()).unwrap();
            assert_eq!(turn["itemTimings"], case["expected"], "{}", case["name"]);
        }
    }
}

#[test]
fn codex_166_errors_should_preserve_public_classification() {
    for (native, code) in [
        ("modelNotFound", "bad_request"),
        ("policyCapacityUnavailable", "policy_blocked"),
    ] {
        let event = map_server_message(
            ServerMessage {
                id: None,
                method: "error".to_owned(),
                params: to_raw_value(&json!({
                    "threadId": "task-1", "turnId": "turn-1", "willRetry": false,
                    "error": {"codexErrorInfo": native, "message": "服务端拒绝当前请求"}
                }))
                .unwrap(),
            },
            1,
            "2026-11-02T00:00:00Z",
        )
        .unwrap()
        .unwrap();
        assert_eq!(event["payload"]["code"], code);
        assert_eq!(event["payload"]["message"], "服务端拒绝当前请求");
        assert_eq!(event["payload"]["willRetry"], false);
    }
}
