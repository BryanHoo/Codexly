use super::{MAX_BYTES, MAX_FIELD_BYTES, MAX_TASKS, MetadataUpdate, TaskSnapshotMetadata};
use serde_json::{Value, json};

fn observe(cache: &mut TaskSnapshotMetadata, task: &str, plan: Value) {
    let event = json!({"taskId":task,"type":"plan.updated","payload":{"plan":plan}}).into();
    cache.observe("project-a", task, MetadataUpdate::prepare(&event).unwrap());
}

#[test]
fn metadata_retention_is_bounded_by_task_count_and_replaces_old_values() {
    let mut cache = TaskSnapshotMetadata::default();
    for index in 0..=MAX_TASKS {
        observe(&mut cache, &format!("task-{index}"), json!({"steps":[]}));
    }
    assert_eq!(cache.tasks.len(), MAX_TASKS);
    assert!(!cache.tasks.contains_key("task-0"));
    let old_bytes = cache.bytes;
    observe(&mut cache, "task-1", json!({"steps":[]}));
    assert_eq!(cache.bytes, old_bytes);
    observe(&mut cache, "task-new", json!({"steps":[]}));
    assert!(cache.tasks.contains_key("task-1"));
    assert!(!cache.tasks.contains_key("task-2"));
}

#[test]
fn metadata_retention_evicts_by_bytes_before_the_task_limit() {
    let mut cache = TaskSnapshotMetadata::default();
    for index in 0..32 {
        observe(
            &mut cache,
            &format!("task-{index}"),
            json!({"explanation":"x".repeat(200_000)}),
        );
        assert!(cache.bytes <= MAX_BYTES);
    }
    assert!(cache.tasks.len() < 32);
    assert!(cache.tasks.contains_key("task-31"));
    assert!(!cache.tasks.contains_key("task-0"));
}

#[test]
fn oversized_metadata_clears_the_previous_value_without_retaining_the_payload() {
    let mut cache = TaskSnapshotMetadata::default();
    observe(&mut cache, "task-a", json!({"steps":[]}));
    observe(
        &mut cache,
        "task-a",
        json!({"explanation":"x".repeat(MAX_FIELD_BYTES)}),
    );
    assert!(cache.tasks["task-a"].plan.is_none());
    assert!(cache.bytes < 100);
}

#[test]
fn project_removal_and_runtime_clear_release_retained_metadata() {
    let mut cache = TaskSnapshotMetadata::default();
    observe(&mut cache, "task-a", json!({"steps":[]}));
    cache.forget_project("unrelated");
    assert_eq!(cache.tasks.len(), 1);
    cache.forget_project("project-a");
    assert_eq!(cache.bytes, 0);
    assert!(cache.tasks.is_empty());
    observe(&mut cache, "task-a", json!({"steps":[]}));
    cache.clear();
    assert_eq!(cache.bytes, 0);
    assert!(cache.tasks.is_empty());
}

#[test]
fn streaming_text_does_not_enter_the_metadata_cache() {
    assert!(
        MetadataUpdate::prepare(
            &json!({
                "taskId":"task-a","type":"message.delta","payload":{"delta":"text"}
            })
            .into()
        )
        .is_none()
    );
}
