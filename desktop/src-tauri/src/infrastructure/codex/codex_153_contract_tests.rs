use serde_json::{Value, json, value::to_raw_value};

use super::{
    connection::ServerMessage,
    conversation::map_item,
    conversation_events::map_server_message,
    tasks::{NativeThread, map_task},
};

#[test]
fn async_questions_should_preserve_official_text_in_history_and_live_items() {
    // 问题只随完整 Item 传输，历史恢复与实时通知必须得到相同结构。
    let text = "选择范围\n- 当前文件\n- 整个项目\n\n补充要求";
    let native = json!({
        "id": "question-a", "type": "agentMessage", "text": text,
        "phase": "final_answer", "delivery": "async", "memoryCitation": null,
        "questions": [
            {"title": "选择范围", "options": ["当前文件", "整个项目"]},
            {"title": "补充要求", "options": null}
        ]
    });
    let history = serde_json::to_value(map_item(native.clone()).unwrap()).unwrap();
    assert_eq!(history["type"], "message");
    assert_eq!(history["role"], "assistant");
    assert_eq!(history["text"], text);
    assert_eq!(history["questions"], native["questions"]);

    for (sequence, method) in ["item/started", "item/completed"].into_iter().enumerate() {
        let event = map_server_message(
            ServerMessage {
                id: None,
                method: method.to_owned(),
                params: to_raw_value(&json!({
                    "threadId": "thread-a", "turnId": "turn-a", "item": native
                }))
                .unwrap(),
            },
            sequence as u64 + 1,
            "2026-09-05T00:00:00Z",
        )
        .unwrap()
        .unwrap();
        assert_eq!(event["type"], method.replace('/', "."));
        assert_eq!(event["payload"]["item"], history);
        assert_eq!(event["turnId"], "turn-a");
    }
}

#[test]
fn nullable_thread_model_metadata_should_keep_task_projection_unchanged() {
    let mut baseline: Option<Value> = None;
    for (model, effort) in [
        (Value::Null, Value::Null),
        (json!("gpt-6-astra"), json!("high")),
    ] {
        let thread: NativeThread = serde_json::from_value(json!({
            "id": "thread-a", "cwd": "/work", "name": "任务", "preview": "",
            "projectId": "project-a", "section": null, "updatedAt": 1788566400,
            "status": {"type": "idle"}, "model": model, "reasoningEffort": effort
        }))
        .unwrap();
        let task = serde_json::to_value(map_task(thread, "project-a")).unwrap();
        if let Some(expected) = &baseline {
            assert_eq!(&task, expected);
        } else {
            assert_eq!(task["id"], "thread-a");
            baseline = Some(task);
        }
    }
}

#[test]
fn async_questions_should_fall_back_to_text_outside_interactive_budget() {
    for questions in [
        json!([]),
        json!(vec![json!({"title": "范围", "options": null}); 17]),
        json!([{"title": "x".repeat(4097), "options": null}]),
        json!([{"title": "范围", "options": vec!["x"; 33]}]),
        json!([{"title": "范围", "options": ["x".repeat(1025)]}]),
        json!(vec![
            json!({"title": "范围", "options": vec!["x".repeat(1024); 32]});
            3
        ]),
    ] {
        let mapped = serde_json::to_value(
            map_item(json!({
                "id": "question-a", "type": "agentMessage", "text": "fallback",
                "delivery": "async", "questions": questions
            }))
            .unwrap(),
        )
        .unwrap();
        assert!(mapped.get("questions").is_none());
        assert_eq!(mapped["text"], "fallback");
    }
}

#[test]
fn synchronous_messages_must_not_create_async_question_forms() {
    let mapped = serde_json::to_value(
        map_item(json!({
            "id": "message-a", "type": "agentMessage", "text": "text", "delivery": null,
            "questions": [{"title": "范围", "options": null}]
        }))
        .unwrap(),
    )
    .unwrap();
    assert!(mapped.get("questions").is_none());
}
