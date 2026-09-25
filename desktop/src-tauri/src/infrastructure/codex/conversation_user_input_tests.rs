use super::*;

fn pending() -> PendingServerRequest {
    map_server_request(
        ServerMessage {
            id: Some(9),
            method: "item/tool/requestUserInput".to_owned(),
            params: serde_json::value::to_raw_value(&json!({
                "threadId": "task", "turnId": "turn", "itemId": "item",
                "questions": [
                    {"id": "choice", "header": "Choice", "question": "Choose",
                     "isOther": true, "options": [{"label": "A", "description": "A"}]},
                    {"id": "secret", "header": "Secret", "question": "Enter", "isSecret": true}
                ]
            }))
            .unwrap(),
        },
        1,
        "2026-09-13T00:00:00Z",
    )
    .unwrap()
    .unwrap()
    .pending
}

#[test]
fn user_input_should_reject_incomplete_unknown_and_malformed_answers() {
    let pending = pending();
    for answers in [
        json!({}),
        json!({"choice": ["A"]}),
        json!({"choice": ["A"], "unknown": ["value"]}),
        json!({"choice": ["A"], "secret": ["value"], "extra": ["value"]}),
        json!({"choice": [], "secret": ["value"]}),
        json!({"choice": ["A", "B"], "secret": ["value"]}),
        json!({"choice": [42], "secret": ["value"]}),
        json!({"choice": "A", "secret": ["value"]}),
        json!({"choice": [null], "secret": ["value"]}),
        json!({"choice": [""], "secret": ["value"]}),
        json!({"choice": [" \n\t　"], "secret": ["value"]}),
    ] {
        assert!(
            matches!(
                response_for_resolution(&pending, &json!({"answers": answers})),
                Err(ConnectionError::InvalidMessage)
            ),
            "invalid answer shape was accepted"
        );
    }
}

#[test]
fn user_input_should_preserve_free_text_and_secret_bytes() {
    assert_eq!(
        response_for_resolution(
            &pending(),
            &json!({"answers": {
                "choice": ["自定义答案 🦀"], "secret": ["  exact secret\n"]
            }})
        )
        .unwrap(),
        json!({"answers": {
            "choice": {"answers": ["自定义答案 🦀"]},
            "secret": {"answers": ["  exact secret\n"]}
        }})
    );
}

#[test]
fn user_input_should_reject_duplicate_question_identity() {
    let mut pending = pending();
    pending.request["questions"][1]["id"] = json!("choice");
    assert!(
        response_for_resolution(
            &pending,
            &json!({"answers": {
                "choice": ["A"], "secret": ["value"]
            }})
        )
        .is_err()
    );
}
