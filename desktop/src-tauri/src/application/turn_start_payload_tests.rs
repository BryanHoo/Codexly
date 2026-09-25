use super::*;
use serde_json::json;

#[test]
fn turn_start_identity_should_include_scope_input_and_options() {
    let input = AgentPromptInput::text("hello");
    let options = AgentTurnOptions::default();
    let original = fingerprint("project", "task", &input, &options)
        .unwrap()
        .digest;
    assert_eq!(
        original,
        fingerprint("project", "task", &input, &options)
            .unwrap()
            .digest
    );
    assert_ne!(
        original,
        fingerprint("other", "task", &input, &options)
            .unwrap()
            .digest
    );
    assert_ne!(
        original,
        fingerprint("project", "other", &input, &options)
            .unwrap()
            .digest
    );
    for changed in [
        AgentPromptInput::text("changed"),
        AgentPromptInput {
            attachments: vec![json!({"id": "attachment-a"})],
            ..input.clone()
        },
        AgentPromptInput {
            skills: vec![json!({"id": "skill-a"})],
            ..input.clone()
        },
    ] {
        assert_ne!(
            original,
            fingerprint("project", "task", &changed, &options)
                .unwrap()
                .digest
        );
    }
    for changed in [
        AgentTurnOptions {
            goal_mode: true,
            ..options.clone()
        },
        AgentTurnOptions {
            fast_mode: true,
            ..options.clone()
        },
        AgentTurnOptions {
            model: "other".into(),
            ..options.clone()
        },
        AgentTurnOptions {
            approval_policy: json!("never"),
            ..options.clone()
        },
        AgentTurnOptions {
            approvals_reviewer: "auto_review".into(),
            ..options.clone()
        },
        AgentTurnOptions {
            reasoning_effort: "low".into(),
            ..options.clone()
        },
        AgentTurnOptions {
            sandbox_mode: "read-only".into(),
            ..options.clone()
        },
        AgentTurnOptions {
            collaboration_mode: Some("plan".into()),
            ..options.clone()
        },
    ] {
        assert_ne!(
            original,
            fingerprint("project", "task", &input, &changed)
                .unwrap()
                .digest
        );
    }
}

#[test]
fn turn_start_identity_should_bound_scope_and_encoded_input() {
    let input = AgentPromptInput::text("hello");
    for (project, task) in [("", "task"), ("project", ""), (&"p".repeat(1025), "task")] {
        assert_eq!(
            fingerprint(project, task, &input, &Default::default())
                .err()
                .unwrap()["code"],
            "INVALID_REQUEST"
        );
    }
    let large = AgentPromptInput::text(&"\0".repeat(MAX_REQUEST_BYTES / 6));
    assert_eq!(
        fingerprint("project", "task", &large, &Default::default())
            .err()
            .unwrap()["code"],
        "INVALID_REQUEST"
    );
}

#[test]
fn turn_start_identity_should_measure_json_bytes_without_retaining_input() {
    let input = AgentPromptInput::text("中文\nquoted \" text");
    let options = AgentTurnOptions::default();
    let encoded = serde_json::to_vec(&("project", "task", &input, &options)).unwrap();
    let identity = fingerprint("project", "task", &input, &options).unwrap();
    assert_eq!(identity.bytes, encoded.len());
    assert_eq!(identity.digest, <[u8; 32]>::from(Sha256::digest(&encoded)));
}

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
