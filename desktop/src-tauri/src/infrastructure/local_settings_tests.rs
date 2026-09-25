use super::local_settings::{
    default_global_settings, project_defaults_from_global, read_global_settings,
    read_project_defaults, update_global_settings, update_project_defaults,
};
use serde_json::{Value, json};
use std::{fs, path::PathBuf};

fn test_root() -> PathBuf {
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir().join(format!(
        "codeagent-local-settings-{}-{nonce}",
        std::process::id()
    ))
}

#[tokio::test]
async fn local_settings_should_not_store_agent_global_defaults() {
    let root = test_root();
    let mut settings = read_global_settings(&root).await.unwrap();
    settings["model"] = json!("global-model");
    settings["followUpBehavior"] = json!("steer");
    update_global_settings(&root, settings).await.unwrap();
    let stored: Value =
        serde_json::from_slice(&fs::read(root.join("agent-settings.json")).unwrap()).unwrap();
    for field in [
        "model",
        "webSearch",
        "modelVerbosity",
        "approvalPolicy",
        "approvalsReviewer",
        "fastMode",
        "reasoningEffort",
        "sandboxMode",
    ] {
        assert!(stored["global"].get(field).is_none(), "{field}");
    }
    assert_eq!(stored["global"]["followUpBehavior"], "steer");
    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn settings_should_persist_local_preferences_and_explicit_project_overrides() {
    let root = test_root();
    assert!(
        read_project_defaults(&root, "project-a")
            .await
            .unwrap()
            .is_none()
    );
    let mut global = default_global_settings();
    global["followUpBehavior"] = json!("steer");
    assert_eq!(
        update_global_settings(&root, global.clone())
            .await
            .unwrap()
            .changed_fields,
        ["followUpBehavior"]
    );
    assert_eq!(read_global_settings(&root).await.unwrap(), global);
    assert!(
        update_global_settings(&root, global.clone())
            .await
            .unwrap()
            .changed_fields
            .is_empty()
    );
    // 显式保存与全局相同的值后，项目也应拥有独立覆盖值。
    let project = project_defaults_from_global(&global);
    update_project_defaults(&root, "project-a", project.clone())
        .await
        .unwrap();
    assert_eq!(
        read_project_defaults(&root, "project-a").await.unwrap(),
        Some(project.clone())
    );
    let stored: Value =
        serde_json::from_slice(&fs::read(root.join("agent-settings.json")).unwrap()).unwrap();
    assert_eq!(stored["projects"]["project-a"], project);
    assert!(fs::read_dir(&root).unwrap().all(|entry| {
        !entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .ends_with(".tmp")
    }));
    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn local_settings_should_ignore_old_agent_defaults_and_preserve_project_preferences() {
    let root = test_root();
    let mut old = default_global_settings();
    old["model"] = json!("obsolete-local-model");
    old["webSearch"] = json!("live");
    old["followUpBehavior"] = json!("steer");
    let project = project_defaults_from_global(&old);
    fs::create_dir_all(&root).unwrap();
    fs::write(
        root.join("agent-settings.json"),
        serde_json::to_vec(
            &json!({"version": 1, "global": old, "projects": {"project-a": project}}),
        )
        .unwrap(),
    )
    .unwrap();
    let settings = read_global_settings(&root).await.unwrap();
    assert_eq!(settings["model"], default_global_settings()["model"]);
    assert_eq!(settings["webSearch"], "cached");
    assert_eq!(settings["followUpBehavior"], "steer");
    assert_eq!(
        read_project_defaults(&root, "project-a").await.unwrap(),
        Some(project)
    );
    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn concurrent_settings_updates_should_preserve_both_atomic_changes() {
    let root = test_root();
    let mut global = default_global_settings();
    global["followUpBehavior"] = json!("steer");
    let mut project = project_defaults_from_global(&global);
    project["model"] = json!("gpt-project");
    let (global_result, project_result) = tokio::join!(
        update_global_settings(&root, global),
        update_project_defaults(&root, "project-a", project)
    );
    global_result.unwrap();
    project_result.unwrap();
    assert_eq!(
        read_global_settings(&root).await.unwrap()["followUpBehavior"],
        "steer"
    );
    assert_eq!(
        read_project_defaults(&root, "project-a")
            .await
            .unwrap()
            .unwrap()["model"],
        "gpt-project"
    );
    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn settings_should_reject_duplicate_persisted_fields() {
    let root = test_root();
    fs::create_dir_all(&root).unwrap();
    fs::write(root.join("agent-settings.json"), br#"{"version":1,"global":{"followUpBehavior":"queue","followUpBehavior":"steer"},"projects":{}}"#).unwrap();
    assert!(read_global_settings(&root).await.is_err());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn typed_settings_should_enforce_fields_nullability_and_bounds() {
    use super::local_settings::validate_global_settings;
    for (field, value) in [
        ("fastMode", json!("true")),
        ("followUpBehavior", json!("invalid")),
        ("sandboxMode", json!("invalid")),
        ("approvalsReviewer", json!("invalid")),
        ("modelVerbosity", json!("invalid")),
        ("webSearch", json!("invalid")),
        ("approvalPolicy", json!("untrusted")),
        ("approvalPolicy", json!({"granular": true})),
        ("model", json!(" ")),
        ("reasoningEffort", json!("x".repeat(65))),
        ("commitMessageModel", json!("x".repeat(257))),
        ("commitMessagePrompt", json!("x".repeat(4001))),
        ("pet", json!({"enabled":false})),
    ] {
        let mut settings = default_global_settings();
        settings[field] = value;
        assert!(validate_global_settings(&settings).is_err(), "{field}");
    }
    for field in ["defaultOpenAppId", "modelVerbosity", "pet", "model"] {
        let mut settings = default_global_settings();
        settings.as_object_mut().unwrap().remove(field);
        assert!(
            validate_global_settings(&settings).is_err(),
            "missing {field}"
        );
    }
    let mut settings = default_global_settings();
    settings["extra"] = json!(true);
    assert!(validate_global_settings(&settings).is_err());
    let mut settings = default_global_settings();
    settings["approvalPolicy"] = json!({"granular":{"sandbox_approval":true}});
    settings["commitMessagePrompt"] = json!("x".repeat(4000));
    assert!(validate_global_settings(&settings).is_ok());
}

#[tokio::test]
async fn invalid_settings_should_leave_existing_file_unchanged() {
    let root = test_root();
    let mut settings = default_global_settings();
    settings["followUpBehavior"] = json!("steer");
    update_global_settings(&root, settings.clone())
        .await
        .unwrap();
    let original = fs::read(root.join("agent-settings.json")).unwrap();
    settings["pet"] = json!({"enabled": "yes", "selectedPetId": null});
    assert!(update_global_settings(&root, settings).await.is_err());
    assert_eq!(
        fs::read(root.join("agent-settings.json")).unwrap(),
        original
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn typed_settings_should_reject_positional_arrays() {
    let mut settings = default_global_settings();
    settings["pet"] = json!([false, null]);
    assert!(super::local_settings::validate_global_settings(&settings).is_err());
}

#[tokio::test]
async fn stored_settings_should_reject_arrays_in_object_fields() {
    let root = test_root();
    fs::create_dir_all(&root).unwrap();
    for document in [
        json!({"version":1,"global":[],"projects":{}}),
        json!({"version":1,"global":{},"projects":{"a":["never","user",false,"model","high","read-only"]}}),
        json!({"version":1,"global":{"pet":[false,null]},"projects":{}}),
    ] {
        fs::write(
            root.join("agent-settings.json"),
            serde_json::to_vec(&document).unwrap(),
        )
        .unwrap();
        assert!(read_global_settings(&root).await.is_err());
    }
    fs::remove_dir_all(root).unwrap();
}
