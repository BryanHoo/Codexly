use codeagent_lib::domain::project_terminal::*;
use serde_json::json;

#[test]
fn metadata_and_exit_event_preserve_camel_case_and_decimal_u64() {
    let metadata = TerminalMetadata {
        scope: TerminalScope {
            project_id: "p".into(),
            terminal_id: "t".into(),
            generation: "g".into(),
        },
        root_id: "r".into(),
        title: "zsh".into(),
        state: TerminalState::Exited,
        cols: 80,
        rows: 24,
        exit_code: Some(0),
    };
    let event = TerminalControlEvent {
        sequence: DecimalU64(u64::MAX),
        event: TerminalEvent::Exited {
            metadata,
            final_offset: DecimalU64(u64::MAX),
            truncated_reason: None,
        },
    };
    assert_eq!(
        serde_json::to_value(event).unwrap(),
        json!({
            "sequence": "18446744073709551615", "type": "exited", "data": {
                "projectId": "p", "terminalId": "t", "generation": "g", "rootId": "r", "title": "zsh",
                "state": "exited", "cols": 80, "rows": 24, "exitCode": 0,
                "finalOffset": "18446744073709551615", "truncatedReason": null
            }
        })
    );
}

#[test]
fn frames_use_little_endian_header_and_unmodified_utf8_fragments() {
    assert_eq!(
        encode_frame(1, 2, &[0xe4, 0xb8]).unwrap(),
        [1, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0xe4, 0xb8]
    );
    assert!(encode_frame(0, 1, &[0]).is_err());
    assert!(encode_frame(1, 1, &[0; 2]).is_err());
    assert!(encode_frame(1, 16385, &[0; 16385]).is_err());
}

#[test]
fn input_headers_decode_once_and_reject_malformed_or_unbounded_values() {
    assert_eq!(
        decode_scope_id("%E9%A1%B9%E7%9B%AE%252F").unwrap(),
        "项目%2F"
    );
    for value in ["", "%", "%GG", "%FF", "%00", "%0A"] {
        assert!(decode_scope_id(value).is_err());
    }
    assert!(decode_scope_id(&"a".repeat(257)).is_err());
    for value in ["01", "-1", "1.0", "18446744073709551616"] {
        assert!(value.parse::<DecimalU64>().is_err());
    }
}
