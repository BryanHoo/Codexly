use std::sync::atomic::{AtomicU64, Ordering};

use serde_json::json;

use super::task_settings::{delete_task_settings, read_task_settings, write_task_settings};
use crate::domain::conversation::AgentTaskSettings;

static TEST_ID: AtomicU64 = AtomicU64::new(1);

fn settings(model: &str) -> AgentTaskSettings {
    AgentTaskSettings {
        approval_policy: json!("on-request"),
        approvals_reviewer: "user".to_owned(),
        model: model.to_owned(),
        reasoning_effort: "high".to_owned(),
        sandbox_mode: "workspace-write".to_owned(),
    }
}

#[tokio::test]
async fn task_settings_should_survive_new_reads_and_replace_atomically() {
    let root = std::env::temp_dir().join(format!(
        "codeagent-task-settings-{}-{}",
        std::process::id(),
        TEST_ID.fetch_add(1, Ordering::Relaxed)
    ));

    assert!(
        read_task_settings(&root, "project-a", "thread-a")
            .await
            .expect("missing settings should be readable")
            .is_none()
    );
    write_task_settings(&root, "project-a", "thread-a", &settings("model-a"))
        .await
        .expect("settings should persist");
    assert_eq!(
        read_task_settings(&root, "project-a", "thread-a")
            .await
            .expect("settings should restore")
            .expect("settings should exist")
            .model,
        "model-a"
    );

    write_task_settings(&root, "project-a", "thread-a", &settings("model-b"))
        .await
        .expect("settings should replace");
    assert_eq!(
        read_task_settings(&root, "project-a", "thread-a")
            .await
            .expect("replaced settings should restore")
            .expect("replaced settings should exist")
            .model,
        "model-b"
    );

    delete_task_settings(&root, "project-a", "thread-a")
        .await
        .expect("settings should delete");
    assert!(
        read_task_settings(&root, "project-a", "thread-a")
            .await
            .expect("deleted settings should be readable")
            .is_none()
    );
    tokio::fs::remove_dir_all(root)
        .await
        .expect("test directory should clean up");
}

#[tokio::test]
async fn task_settings_failed_replace_should_preserve_existing_target() {
    let root = std::env::temp_dir().join(format!(
        "codeagent-settings-failure-{}-{}",
        std::process::id(),
        TEST_ID.fetch_add(1, Ordering::Relaxed)
    ));
    let target = root.join("task-settings/project-a/thread-a.json");
    tokio::fs::create_dir_all(&target).await.unwrap();
    tokio::fs::write(target.join("preserve.txt"), "existing data")
        .await
        .unwrap();
    assert!(
        write_task_settings(&root, "project-a", "thread-a", &settings("model-b"))
            .await
            .is_err()
    );
    assert_eq!(
        tokio::fs::read_to_string(target.join("preserve.txt"))
            .await
            .unwrap(),
        "existing data"
    );
    let mut entries = tokio::fs::read_dir(target.parent().unwrap()).await.unwrap();
    assert_eq!(
        entries.next_entry().await.unwrap().unwrap().file_name(),
        "thread-a.json"
    );
    assert!(entries.next_entry().await.unwrap().is_none());
    tokio::fs::remove_dir_all(root).await.unwrap();
}
