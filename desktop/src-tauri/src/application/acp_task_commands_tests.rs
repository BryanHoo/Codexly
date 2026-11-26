#[test]
fn task_management_should_accept_pin_and_reject_unknown_arguments() {
    assert!(
        super::validate_request("task.pin", &serde_json::json!({"taskId":"t","pinned":true}))
            .is_ok()
    );
    for (method, params) in [
        (
            "task.pin",
            serde_json::json!({"taskId":"t","pinned":"true"}),
        ),
        ("task.rename", serde_json::json!({"taskId":"t","title":" "})),
        (
            "task.rename",
            serde_json::json!({"taskId":"t","title":"x".repeat(201)}),
        ),
        (
            "task.rename",
            serde_json::json!({"taskId":"t","title":"😀".repeat(101)}),
        ),
        (
            "task.archive",
            serde_json::json!({"taskId":"t","scope":{"id":"other"}}),
        ),
        (
            "task.unarchive",
            serde_json::json!({"taskId":"t","force":true}),
        ),
        (
            "task.delete",
            serde_json::json!({"taskId":"t","rootPath":"/secret"}),
        ),
    ] {
        assert!(super::validate_request(method, &params).is_err());
    }
}

#[test]
fn task_subscription_should_accept_owned_identity_only() {
    for method in ["task.retain", "task.release"] {
        assert!(
            super::validate_request(method, &serde_json::json!({"taskId":"t","leaseId":"view"}))
                .is_ok()
        );
        for invalid in [
            serde_json::json!({"taskId":"t"}),
            serde_json::json!({"taskId":"t","leaseId":" "}),
            serde_json::json!({"taskId":"t","leaseId":"x".repeat(129)}),
            serde_json::json!({"taskId":"t","leaseId":"view","scope":{"id":"other"}}),
        ] {
            assert!(super::validate_request(method, &invalid).is_err());
        }
    }
}

#[test]
fn configured_prompt_should_require_identity_and_reject_legacy_options() {
    let request = serde_json::json!({"taskId":"t","idempotencyKey":"once","input":{"text":"x","attachments":[],"skills":[]}});
    assert!(super::validate_request("prompt.start", &request).is_ok());
    let mut configured = request.clone();
    configured["initialConfig"] = serde_json::json!({"enabled":false});
    assert!(super::validate_request("prompt.start", &configured).is_ok());
    configured["initialConfig"] = serde_json::json!({"enabled":1});
    assert!(super::validate_request("prompt.start", &configured).is_err());
    let mut legacy = request.clone();
    legacy["options"] = serde_json::json!({"model":"old"});
    assert!(super::validate_request("prompt.start", &legacy).is_err());
    let mut missing = request;
    missing.as_object_mut().unwrap().remove("idempotencyKey");
    assert!(super::validate_request("prompt.start", &missing).is_err());
}
use serde_json::json;
#[test]
fn task_request_should_reject_raw_paths_and_unknown_methods() {
    assert!(super::validate_request("close", &json!({"taskId":"t"})).is_err());
    assert!(
        super::validate_request(
            "turn.start",
            &json!({"taskId":"t","input":{"text":"x","files":[{"path":"/secret"}]}})
        )
        .is_err()
    );
    assert!(super::validate_request("task.read", &json!({"taskId":"t"})).is_ok());
    assert!(super::validate_request("session.state.read", &json!({"taskId":"t"})).is_ok());
}
#[test]
fn queue_should_accept_only_authorized_input_and_known_operations() {
    for method in ["queue.add", "queue.update"] {
        assert!(
            super::validate_request(
                method,
                &json!({"taskId":"t","input":{"text":"q","attachments":[]}})
            )
            .is_ok()
        );
        assert!(
            super::validate_request(
                method,
                &json!({"taskId":"t","input":{"text":"q","images":[{"path":"/secret"}]}})
            )
            .is_err()
        );
    }
    for method in [
        "queue.list",
        "queue.start",
        "queue.delete",
        "queue.move",
        "queue.reorder",
    ] {
        assert!(super::validate_request(method, &json!({"taskId":"t"})).is_ok());
    }
    assert!(super::validate_request("queue.clearAnything", &json!({"taskId":"t"})).is_err());
}

#[test]
fn continuation_prompt_requires_initial_config_and_a_valid_source() {
    let mut request = serde_json::json!({"taskId":"new","idempotencyKey":"once","input":{"text":"继续"},"continuationSourceTaskId":"old"});
    assert!(super::validate_request("prompt.start", &request).is_err());
    request["initialConfig"] = serde_json::json!({});
    assert!(super::validate_request("prompt.start", &request).is_ok());
    request["continuationSourceTaskId"] = serde_json::json!(" ");
    assert!(super::validate_request("prompt.start", &request).is_err());
}
