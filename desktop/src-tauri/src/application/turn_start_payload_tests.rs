use super::*;
use serde_json::json;

#[test]
fn turn_start_result_should_preserve_exact_success_and_error_shapes() {
    for result in [
        Ok(json!({"turn": {"id": "turn-a"}, "checkpoint": {"sequence": 42}})),
        Err(json!("transport failed")),
        Err(json!({"code": "CODEX_THREAD_BUSY", "message": "busy"})),
    ] {
        let encoded = encode_result(&result);
        assert_eq!(
            serde_json::from_slice::<TurnStartResult>(&encoded).unwrap(),
            result
        );
    }
}
