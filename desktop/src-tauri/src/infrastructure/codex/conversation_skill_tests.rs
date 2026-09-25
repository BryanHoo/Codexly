use serde_json::{Value, json, to_value, value::to_raw_value};

use super::{
    ServerMessage,
    conversation::{map_item, map_turn},
    conversation_events::map_server_message,
};

fn user(id: &str, text: &str, names: &[&str]) -> Value {
    let mut content = Vec::new();
    if !text.is_empty() {
        content.push(json!({"type":"text", "text":text, "text_elements":[]}));
    }
    content.extend(
        names
            .iter()
            .map(|name| json!({"type":"skill", "name":name, "path":"/skills/test"})),
    );
    json!({"id":id,"type":"userMessage","content":content})
}

fn turn(items: Vec<Value>) -> Value {
    json!({"id":"turn", "status":"completed", "error":null, "items":items})
}

#[test]
fn skill_text_normalization_should_remove_only_known_leading_references() {
    for (text, expected) in [
        (" \t$rust $测试\n修复代码 $rust", "修复代码 $rust"),
        ("$rust$测试 修复代码", "修复代码"),
        (" $unknown $rust keep", " $unknown $rust keep"),
        ("$rust-lang keep", "$rust-lang keep"),
        ("正文 $rust", "正文 $rust"),
        ("$$rust keep", "$$rust keep"),
        ("$rust", ""),
        ("\u{feff}$rust\u{00a0}正文", "正文"),
        ("\u{0085}$rust 正文", "\u{0085}$rust 正文"),
    ] {
        let mapped = to_value(map_item(user("user", text, &["rust", "测试"])).unwrap()).unwrap();
        assert_eq!(mapped["text"], expected, "input: {text}");
        assert_eq!(mapped["id"], "user");
    }
}

#[test]
fn skill_mapping_should_distinguish_expansion_from_normalized_empty_input() {
    let expansion = to_value(map_item(user("expanded", "", &["rust"])).unwrap()).unwrap();
    let input = to_value(map_item(user("user", "$rust", &["rust"])).unwrap()).unwrap();
    assert_eq!(expansion["skillExpansion"], true);
    assert_eq!(input["text"], "");
    assert!(input.get("skillExpansion").is_none());
}

#[test]
fn skill_turn_mapping_should_not_merge_independent_messages_or_cross_activity_boundaries() {
    let mut with_image = user("with-image", "", &["rust"]);
    with_image["content"]
        .as_array_mut()
        .unwrap()
        .push(json!({"type":"image", "url":"https://example.com/image.png"}));
    let raw = turn(vec![
        user("first", "保留第一条消息", &[]),
        user("skill-only-input", "$rust", &["rust"]),
        user("separate-input", "第二条消息", &["rust"]),
        with_image,
        json!({"id":"activity", "type":"hookPrompt", "fragments":[]}),
        user("after-activity", "", &["rust"]),
    ]);
    let mapped = to_value(map_turn(serde_json::from_value(raw).unwrap()).unwrap()).unwrap();
    let items = mapped["items"].as_array().unwrap();
    assert_eq!(
        items
            .iter()
            .map(|item| item["id"].as_str().unwrap())
            .collect::<Vec<_>>(),
        [
            "first",
            "skill-only-input",
            "separate-input",
            "with-image",
            "activity",
            "after-activity"
        ]
    );
    assert_eq!(items[1]["text"], "");
    assert_eq!(items[3]["attachments"].as_array().unwrap().len(), 1);
}

#[test]
fn skill_item_events_should_normalize_without_changing_provider_identity() {
    for method in ["item/started", "item/completed"] {
        let event = map_server_message(ServerMessage {
            id: None, method: method.into(),
            params: to_raw_value(&json!({"threadId":"task", "turnId":"turn", "item":user("user", "$rust 修复代码", &["rust", "rust"])})).unwrap(),
        }, 1, "2026-09-12T00:00:00Z").unwrap().unwrap();
        assert_eq!(event["itemId"], "user");
        assert_eq!(event["payload"]["item"]["id"], "user");
        assert_eq!(event["payload"]["item"]["text"], "修复代码");
        assert_eq!(event["payload"]["item"]["skills"], json!([{"name":"rust"}]));
    }
}

#[test]
fn skill_turn_mapping_should_merge_adjacent_expansions_without_moving_messages() {
    let mut original = user("user", "$rust $测试 修复代码", &[]);
    original["content"]
        .as_array_mut()
        .unwrap()
        .push(json!({"type":"image", "url":"https://example.com/image.png"}));
    let raw = turn(vec![
        original,
        user("expanded-a", "", &["rust"]),
        user("expanded-b", "", &["rust", "测试"]),
        json!({"id":"assistant", "type":"agentMessage", "text":"完成"}),
    ]);
    let mapped = to_value(map_turn(serde_json::from_value(raw).unwrap()).unwrap()).unwrap();
    assert_eq!(mapped["items"].as_array().unwrap().len(), 2);
    assert_eq!(mapped["items"][0]["id"], "user");
    assert_eq!(mapped["items"][0]["text"], "修复代码");
    assert_eq!(
        mapped["items"][0]["skills"],
        json!([{"name":"rust"},{"name":"测试"}])
    );
    assert_eq!(
        mapped["items"][0]["attachments"][0]["id"],
        "https://example.com/image.png"
    );
    assert_eq!(mapped["items"][1]["id"], "assistant");
}

#[test]
fn skill_turn_events_should_share_the_history_normalization() {
    let raw = turn(vec![
        user("user", "$rust 修复代码", &[]),
        user("expanded", "", &["rust"]),
    ]);
    let expected =
        to_value(map_turn(serde_json::from_value(raw.clone()).unwrap()).unwrap()).unwrap();
    for method in ["turn/started", "turn/completed"] {
        let event = map_server_message(
            ServerMessage {
                id: None,
                method: method.into(),
                params: to_raw_value(&json!({"threadId":"task", "turn":raw})).unwrap(),
            },
            1,
            "2026-09-12T00:00:00Z",
        )
        .unwrap()
        .unwrap();
        assert_eq!(event["payload"]["turn"], expected);
        assert_eq!(
            event["payload"]["turn"]["items"].as_array().unwrap().len(),
            1
        );
    }
}
