use super::{AppServerConnection, agent_settings::*};
use crate::infrastructure::local_settings;

#[tokio::test]
async fn fast_mode_should_recognize_codex_priority_value() {
    let fixture = Fixture::new(json!({"service_tier": "priority"}), false);
    assert_eq!(
        read_global_settings(&fixture.connection, &fixture.root)
            .await
            .unwrap()["fastMode"],
        true
    );
}
use serde_json::{Value, json};
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, duplex, split};

struct Fixture {
    connection: AppServerConnection,
    requests: Arc<Mutex<Vec<Value>>>,
    root: PathBuf,
    server: tokio::task::JoinHandle<()>,
}

impl Fixture {
    fn new(mut config: Value, reject_write: bool) -> Self {
        let (client, server) = duplex(16384);
        let (reader, writer) = split(client);
        let connection = AppServerConnection::new(reader, writer);
        let requests = Arc::new(Mutex::new(Vec::new()));
        let captured = Arc::clone(&requests);
        let server = tokio::spawn(async move {
            let (reader, mut writer) = split(server);
            let mut lines = BufReader::new(reader).lines();
            while let Some(line) = lines.next_line().await.unwrap() {
                let request: Value = serde_json::from_str(&line).unwrap();
                captured.lock().unwrap().push(request.clone());
                let response = match request["method"].as_str().unwrap() {
                    "config/read" => {
                        assert!(request["params"].get("cwd").is_none());
                        json!({"id": request["id"], "result": {"config": config}})
                    }
                    "config/batchWrite" => {
                        assert!(request["params"].get("filePath").is_none());
                        assert_eq!(request["params"]["reloadUserConfig"], true);
                        if reject_write {
                            json!({"id": request["id"], "error": {"code": -32600, "message": "managed setting"}})
                        } else {
                            for edit in request["params"]["edits"].as_array().unwrap() {
                                assert_eq!(edit["mergeStrategy"], "replace");
                                config[edit["keyPath"].as_str().unwrap()] = edit["value"].clone();
                            }
                            json!({"id": request["id"], "result": {"status": "ok"}})
                        }
                    }
                    _ => panic!("unexpected request: {request}"),
                };
                writer
                    .write_all(format!("{response}\n").as_bytes())
                    .await
                    .unwrap();
            }
        });
        Self {
            connection,
            requests,
            root: std::env::temp_dir().join(format!(
                "codeagent-agent-settings-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            )),
            server,
        }
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        self.server.abort();
        if self.root.exists() {
            std::fs::remove_dir_all(&self.root).unwrap();
        }
    }
}

#[tokio::test]
async fn global_defaults_should_read_codex_and_write_only_changed_standard_keys() {
    let fixture = Fixture::new(
        json!({"model": "codex-model", "web_search": "live", "service_tier": "fast"}),
        false,
    );
    let mut settings = read_global_settings(&fixture.connection, &fixture.root)
        .await
        .unwrap();
    assert_eq!(settings["model"], "codex-model");
    assert_eq!(settings["webSearch"], "live");
    assert_eq!(settings["fastMode"], true);
    settings["model"] = json!("new-model");
    settings["fastMode"] = json!(false);
    settings["followUpBehavior"] = json!("steer");
    let update = update_global_settings(&fixture.connection, &fixture.root, settings.clone())
        .await
        .unwrap();
    assert_eq!(update.settings, settings);
    assert_eq!(
        update.changed_fields,
        ["fastMode", "followUpBehavior", "model"]
    );
    let requests = fixture.requests.lock().unwrap();
    let writes = requests
        .iter()
        .filter(|request| request["method"] == "config/batchWrite")
        .collect::<Vec<_>>();
    assert_eq!(writes.len(), 1);
    assert_eq!(
        writes[0]["params"]["edits"],
        json!([
                {"keyPath": "service_tier", "value": "default", "mergeStrategy": "replace"},
            {"keyPath": "model", "value": "new-model", "mergeStrategy": "replace"},
        ])
    );
    let stored: Value =
        serde_json::from_slice(&std::fs::read(fixture.root.join("agent-settings.json")).unwrap())
            .unwrap();
    assert!(stored["global"].get("model").is_none());
}

#[tokio::test]
async fn agent_fields_should_round_trip_through_codex_including_null_verbosity() {
    let fixture = Fixture::new(json!({}), false);
    let mut settings = local_settings::default_global_settings();
    for (key, value) in [
        ("approvalPolicy", json!("never")),
        ("approvalsReviewer", json!("auto_review")),
        ("fastMode", json!(true)),
        ("model", json!("new-model")),
        ("modelVerbosity", json!("high")),
        ("reasoningEffort", json!("low")),
        ("sandboxMode", json!("read-only")),
        ("webSearch", json!("disabled")),
    ] {
        settings[key] = value;
    }
    assert_eq!(
        update_global_settings(&fixture.connection, &fixture.root, settings.clone())
            .await
            .unwrap()
            .settings,
        settings
    );
    let runtime = read_agent_runtime_settings(&fixture.connection)
        .await
        .unwrap();
    assert_eq!(
        serde_json::to_value(runtime.web_search).unwrap(),
        "disabled"
    );
    assert_eq!(
        serde_json::to_value(runtime.model_verbosity).unwrap(),
        "high"
    );
    settings["modelVerbosity"] = Value::Null;
    assert_eq!(
        update_global_settings(&fixture.connection, &fixture.root, settings)
            .await
            .unwrap()
            .settings["modelVerbosity"],
        Value::Null
    );
    assert!(
        read_agent_runtime_settings(&fixture.connection)
            .await
            .unwrap()
            .model_verbosity
            .is_none()
    );
    assert!(!fixture.root.exists());
}

#[tokio::test]
async fn project_overrides_should_remain_local_and_unconfigured_projects_inherit_codex() {
    let fixture = Fixture::new(json!({"model": "global-model"}), false);
    let inherited = read_project_defaults(&fixture.connection, &fixture.root, "project-a")
        .await
        .unwrap();
    assert_eq!(inherited["model"], "global-model");
    local_settings::update_project_defaults(&fixture.root, "project-a", inherited.clone())
        .await
        .unwrap();
    let request_count = fixture.requests.lock().unwrap().len();
    assert_eq!(
        read_project_defaults(&fixture.connection, &fixture.root, "project-a")
            .await
            .unwrap(),
        inherited
    );
    assert_eq!(fixture.requests.lock().unwrap().len(), request_count);
    let mut global = read_global_settings(&fixture.connection, &fixture.root)
        .await
        .unwrap();
    global["model"] = json!("changed-global-model");
    update_global_settings(&fixture.connection, &fixture.root, global)
        .await
        .unwrap();
    assert_eq!(
        read_project_defaults(&fixture.connection, &fixture.root, "project-a")
            .await
            .unwrap()["model"],
        "global-model"
    );
    assert_eq!(
        read_project_defaults(&fixture.connection, &fixture.root, "project-b")
            .await
            .unwrap()["model"],
        "changed-global-model"
    );
}

#[tokio::test]
async fn rejected_codex_write_should_not_save_local_preferences() {
    let fixture = Fixture::new(json!({}), true);
    let mut settings = local_settings::default_global_settings();
    settings["model"] = json!("rejected-model");
    settings["followUpBehavior"] = json!("steer");
    assert!(matches!(
        update_global_settings(&fixture.connection, &fixture.root, settings).await,
        Err(AgentSettingsError::Connection(_))
    ));
    assert!(!fixture.root.exists());
}

#[tokio::test]
async fn unchanged_or_local_only_settings_should_not_write_codex() {
    let fixture = Fixture::new(json!({}), false);
    let mut settings = local_settings::default_global_settings();
    assert!(
        update_global_settings(&fixture.connection, &fixture.root, settings.clone())
            .await
            .unwrap()
            .changed_fields
            .is_empty()
    );
    settings["followUpBehavior"] = json!("steer");
    update_global_settings(&fixture.connection, &fixture.root, settings)
        .await
        .unwrap();
    assert!(
        fixture
            .requests
            .lock()
            .unwrap()
            .iter()
            .all(|request| request["method"] == "config/read")
    );
}

#[tokio::test]
async fn invalid_settings_should_fail_before_any_rpc_or_local_write() {
    let fixture = Fixture::new(json!({}), false);
    let mut settings = local_settings::default_global_settings();
    settings["webSearch"] = json!("invalid");
    assert!(
        update_global_settings(&fixture.connection, &fixture.root, settings)
            .await
            .is_err()
    );
    assert!(fixture.requests.lock().unwrap().is_empty());
    assert!(!fixture.root.exists());
}
