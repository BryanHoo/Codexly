use super::{MAX_ALIASES, MAX_BYTES, MAX_TASKS, SkillMessage, TaskSkillProjection};
use crate::domain::runtime::AgentEvent;
use serde_json::{Value, json};

fn item(id: &str, text: &str, expansion: bool) -> Value {
    let mut value = json!({"id":id,"type":"message","role":"user","text":text});
    if expansion {
        value["skillExpansion"] = true.into();
        value["skills"] = json!([{"name":"rust"}]);
    }
    value
}

fn event(task: &str, turn: &str, kind: &str, payload: Value) -> AgentEvent {
    json!({"type":kind,"taskId":task,"turnId":turn,"itemId":payload["item"]["id"],"payload":payload}).into()
}

fn observe(cache: &mut TaskSkillProjection, project: &str, mut event: AgentEvent) -> Value {
    let message = SkillMessage::prepare(&event);
    cache.observe(project, &mut event, message);
    event.as_json().unwrap().clone()
}

fn publish(cache: &mut TaskSkillProjection, task: &str, value: Value) -> Value {
    observe(
        cache,
        "project",
        event(task, "turn", "item.started", json!({"item":value})),
    )
}

#[test]
fn skill_projection_should_keep_aliases_across_late_lifecycle_events() {
    let mut cache = TaskSkillProjection::default();
    publish(&mut cache, "task", item("user", "$rust 修复代码", false));
    let patch = publish(&mut cache, "task", item("expanded", "", true));
    assert_eq!(patch["type"], "message.skills_updated");
    assert_eq!(patch["itemId"], "user");
    assert_eq!(
        patch["payload"],
        json!({"text":"修复代码","skills":[{"name":"rust"}]})
    );
    publish(
        &mut cache,
        "task",
        json!({"id":"assistant","type":"message","role":"assistant","text":"处理中"}),
    );
    assert_eq!(
        observe(
            &mut cache,
            "project",
            event(
                "task",
                "turn",
                "item.completed",
                json!({"item":item("expanded", "", true)})
            )
        )["type"],
        "message.skills_updated"
    );
    let completed = observe(
        &mut cache,
        "project",
        event(
            "task",
            "turn",
            "item.completed",
            json!({"item":item("user", "$rust 修复代码", false)}),
        ),
    );
    assert_eq!(completed["payload"]["item"]["text"], "修复代码");
    assert_eq!(
        completed["payload"]["item"]["skills"],
        json!([{"name":"rust"}])
    );
    let terminal = observe(
        &mut cache,
        "project",
        event(
            "task",
            "turn",
            "turn.completed",
            json!({"turn":{
                "id":"turn", "items":[item("user", "$rust 修复代码", false),
                    {"id":"assistant","type":"message","role":"assistant","text":"完成"}, item("expanded", "", true)]
            }}),
        ),
    );
    assert_eq!(
        terminal["payload"]["turn"]["items"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    assert_eq!(terminal["payload"]["turn"]["items"][0]["text"], "修复代码");
}

#[test]
fn skill_projection_should_not_cross_activity_or_merge_normalized_empty_input() {
    let mut cache = TaskSkillProjection::default();
    publish(&mut cache, "task", item("user", "$rust text", false));
    let mut delta = event("task", "turn", "message.delta", json!({"delta":"reply"}));
    assert!(SkillMessage::prepare(&delta).is_none());
    cache.observe("project", &mut delta, None);
    assert_eq!(
        publish(&mut cache, "task", item("independent", "", true))["type"],
        "item.started"
    );
    let normal = publish(&mut cache, "task", item("normal", "", false));
    assert_eq!(normal["itemId"], "normal");
    assert_eq!(cache.tasks["task"].message.id, "normal");
}

#[test]
fn skill_projection_should_preserve_newer_scope_when_old_terminal_arrives() {
    let mut cache = TaskSkillProjection::default();
    publish(&mut cache, "task", item("user", "$rust text", false));
    observe(
        &mut cache,
        "project",
        event(
            "task",
            "old-turn",
            "turn.completed",
            json!({"turn":{"items":[]}}),
        ),
    );
    assert_eq!(
        publish(&mut cache, "task", item("expanded", "", true))["itemId"],
        "user"
    );
}

#[test]
fn skill_projection_should_not_leak_or_erase_other_project_or_turn_associations() {
    let mut cache = TaskSkillProjection::default();
    publish(&mut cache, "task", item("user", "$rust text", false));
    for (project, turn) in [("other-project", "turn"), ("project", "other-turn")] {
        let unrelated = observe(
            &mut cache,
            project,
            event(
                "task",
                turn,
                "item.completed",
                json!({"item":item("unrelated", "", true)}),
            ),
        );
        assert_eq!(unrelated["type"], "item.completed");
    }
    assert_eq!(
        publish(&mut cache, "task", item("expanded", "", true))["itemId"],
        "user"
    );
}

#[test]
fn skill_projection_should_bound_tasks_bytes_aliases_and_oversized_replacements() {
    let mut cache = TaskSkillProjection::default();
    for index in 0..=MAX_TASKS {
        publish(
            &mut cache,
            &format!("task-{index}"),
            item("user", "text", false),
        );
    }
    assert_eq!(cache.tasks.len(), MAX_TASKS);
    assert!(!cache.tasks.contains_key("task-0"));
    for index in 0..16 {
        publish(
            &mut cache,
            &format!("large-{index}"),
            item("user", &"x".repeat(900_000), false),
        );
        assert!(cache.bytes <= MAX_BYTES);
    }
    assert!(cache.tasks.len() < 16);
    publish(&mut cache, "task", item("user", "$rust text", false));
    for index in 0..MAX_ALIASES {
        publish(
            &mut cache,
            "task",
            item(&format!("alias-{index}"), "", true),
        );
    }
    assert_eq!(cache.tasks["task"].aliases.len(), MAX_ALIASES);
    assert_eq!(
        publish(&mut cache, "task", item("over-alias-budget", "", true))["type"],
        "item.started"
    );
    assert!(!cache.tasks["task"].adjacent);
    publish(
        &mut cache,
        "task",
        item("user", &"x".repeat(super::MAX_ENTRY_BYTES + 1), false),
    );
    assert!(!cache.tasks.contains_key("task"));
    assert_eq!(
        cache.bytes,
        cache
            .tasks
            .iter()
            .map(|(task, record)| record.bytes(task))
            .sum::<usize>()
    );
}

#[test]
fn skill_projection_should_release_deleted_scopes_and_keep_same_turn_delayed_start() {
    let mut cache = TaskSkillProjection::default();
    publish(&mut cache, "task", item("user", "$rust text", false));
    observe(
        &mut cache,
        "project",
        event("task", "turn", "turn.started", json!({"turn":{"items":[]}})),
    );
    assert!(cache.tasks.contains_key("task"));
    observe(
        &mut cache,
        "project",
        event(
            "task",
            "new-turn",
            "turn.started",
            json!({"turn":{"items":[]}}),
        ),
    );
    assert_eq!(cache.bytes, 0);
    publish(&mut cache, "task", item("user", "text", false));
    observe(
        &mut cache,
        "project",
        event("task", "turn", "task.removed", json!({})),
    );
    assert_eq!(cache.bytes, 0);
    publish(&mut cache, "task", item("user", "text", false));
    cache.forget_project("project");
    assert_eq!(cache.bytes, 0);
    publish(&mut cache, "task", item("user", "text", false));
    cache.clear();
    assert_eq!(cache.bytes, 0);
}

#[test]
fn skill_projection_should_not_alias_a_standalone_skill_item_to_itself() {
    let mut cache = TaskSkillProjection::default();
    publish(&mut cache, "task", item("standalone", "", true));
    publish(&mut cache, "task", item("standalone", "", true));
    let terminal = observe(
        &mut cache,
        "project",
        event(
            "task",
            "turn",
            "turn.completed",
            json!({"turn":{"items":[item("standalone", "", true)]}}),
        ),
    );
    assert_eq!(
        terminal["payload"]["turn"]["items"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn skill_projection_should_not_reopen_adjacency_on_delayed_nonempty_turn_start() {
    let mut cache = TaskSkillProjection::default();
    publish(&mut cache, "task", item("user", "$rust text", false));
    publish(
        &mut cache,
        "task",
        json!({"id":"assistant","type":"message","role":"assistant","text":"reply"}),
    );
    observe(
        &mut cache,
        "project",
        event(
            "task",
            "turn",
            "turn.started",
            json!({"turn":{"items":[item("user", "$rust text", false)]}}),
        ),
    );
    assert_eq!(
        publish(&mut cache, "task", item("unrelated", "", true))["type"],
        "item.started"
    );
}

#[test]
fn skill_projection_should_not_infer_a_new_target_from_an_unknown_completion() {
    let mut cache = TaskSkillProjection::default();
    observe(
        &mut cache,
        "project",
        event(
            "task",
            "turn",
            "item.started",
            json!({"item":item("new-user", "$rust new", false)}),
        ),
    );
    let late = observe(
        &mut cache,
        "project",
        event(
            "task",
            "turn",
            "item.completed",
            json!({"item":item("old-alias", "", true)}),
        ),
    );
    assert_eq!(late["type"], "item.completed");
    observe(
        &mut cache,
        "project",
        event(
            "task",
            "turn",
            "item.completed",
            json!({"item":item("old-user", "old", false)}),
        ),
    );
    assert_eq!(cache.tasks["task"].message.id, "new-user");
}
