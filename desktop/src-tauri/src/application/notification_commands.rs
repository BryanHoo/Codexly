use std::collections::{BTreeMap, VecDeque};

use serde::Deserialize;
use tauri::{AppHandle, Manager};
use tokio::sync::Mutex;

use super::{notification_delivery, tray_commands::tray_task_route};
use crate::{domain::runtime::AgentEvent, infrastructure::app_storage};

const LANGUAGE_STORAGE_KEY: &str = "codeagent.language-preference";
const MAX_FAILED_TURN_KEYS: usize = 256;
const NOTIFICATION_STORAGE_KEY: &str = "codeagent.notification-preference";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationTaskTarget {
    project_id: String,
    task_id: String,
}

/// 已读只撤销系统提醒，不修改任务审批和待回答事实。
#[tauri::command(rename_all = "camelCase")]
pub fn dismiss_task_notifications(app: AppHandle, tasks: Vec<NotificationTaskTarget>) {
    // 共享历史最多 500 条；此边界同样限制一次请求的处理量。
    for task in tasks.into_iter().take(500) {
        if let Ok(route) = tray_task_route(&task.project_id, &task.task_id) {
            notification_delivery::clear(&app, Some(&route));
        }
    }
}

#[derive(Default)]
pub struct NotificationRuntime {
    state: Mutex<NotificationState>,
    pub(super) deliveries: notification_delivery::DeliveryRegistry,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum NotificationLanguage {
    En,
    ZhCn,
}

#[derive(Debug, Eq, PartialEq)]
pub(super) struct TaskNotification {
    pub(super) body: String,
    pub(super) route: String,
    pub(super) title: String,
    pub(super) identity: Option<String>,
}

#[derive(Default)]
struct NotificationState {
    failed_turn_keys: VecDeque<String>,
    question_keys: VecDeque<String>,
}

#[derive(Deserialize)]
struct StoredNotificationPreference {
    enabled: bool,
    version: u8,
}

#[derive(Deserialize)]
struct StoredLanguagePreference {
    language: String,
    version: u8,
}

pub(super) async fn observe_task_notification(
    app: &AppHandle,
    event: &AgentEvent,
    project_id: &str,
    task_name: Option<&str>,
) {
    // 关闭信号只撤销同一请求，较晚到达的旧请求终态不能移除新问题的提醒。
    if matches!(
        event.event_type(),
        Some("pending_request.resolved" | "pending_request.expired")
    ) {
        if let (Some(task_id), Some(identity)) = (
            event.task_id(),
            event
                .as_json()
                .and_then(|value| value.pointer("/payload/request/requestId"))
                .and_then(serde_json::Value::as_str),
        ) && let Ok(route) = tray_task_route(project_id, task_id)
        {
            app.state::<NotificationRuntime>()
                .deliveries
                .resolve(&route, identity);
        }
        return;
    }
    if matches!(event.event_type(), Some("task.removed" | "turn.started"))
        && let Some(task_id) = event.task_id()
        && let Ok(route) = tray_task_route(project_id, task_id)
    {
        notification_delivery::clear(app, Some(&route));
    }
    if !is_notification_event(event) {
        return;
    }
    let preferences = read_preferences(app).await;
    if !notifications_enabled(&preferences) {
        return;
    }
    let task_name = task_name.or_else(|| event.task_id()).unwrap_or("Task");
    let notification = {
        let runtime = app.state::<NotificationRuntime>();
        let mut state = runtime.state.lock().await;
        reduce_task_notification(
            &mut state,
            event,
            project_id,
            task_name,
            notification_language(&preferences),
        )
    };
    let Some(notification) = notification else {
        return;
    };
    notification_delivery::send(app, notification);
}

async fn read_preferences(app: &AppHandle) -> BTreeMap<String, String> {
    let Ok(app_data) = crate::infrastructure::app_data::directory(app) else {
        return BTreeMap::new();
    };
    app_storage::read_preferences(&app_data)
        .await
        .unwrap_or_default()
}

fn notifications_enabled(preferences: &BTreeMap<String, String>) -> bool {
    preferences
        .get(NOTIFICATION_STORAGE_KEY)
        .and_then(|value| serde_json::from_str::<StoredNotificationPreference>(value).ok())
        .is_none_or(|preference| preference.version != 1 || preference.enabled)
}

fn notification_language(preferences: &BTreeMap<String, String>) -> NotificationLanguage {
    preferences
        .get(LANGUAGE_STORAGE_KEY)
        .and_then(|value| serde_json::from_str::<StoredLanguagePreference>(value).ok())
        .filter(|preference| preference.version == 1 && preference.language == "en")
        .map_or(NotificationLanguage::ZhCn, |_| NotificationLanguage::En)
}

fn is_notification_event(event: &AgentEvent) -> bool {
    matches!(
        event.event_type(),
        Some("pending_request.created" | "provider.error" | "turn.completed")
    ) || super::task_activity::async_questions::is_question_event(event)
}

fn reduce_task_notification(
    state: &mut NotificationState,
    event: &AgentEvent,
    project_id: &str,
    task_name: &str,
    language: NotificationLanguage,
) -> Option<TaskNotification> {
    let event_json = event.as_json()?;
    let body = match event.event_type()? {
        "item.completed" if super::task_activity::async_questions::is_question_event(event) => {
            let key = format!(
                "{project_id}:{}:{}:{}",
                event.task_id()?,
                event_json.get("turnId")?.as_str()?,
                event_json.pointer("/payload/item/id")?.as_str()?
            );
            if state.question_keys.contains(&key) {
                return None;
            }
            // 仅成型问题触发系统通知；有界去重避免事件重放和长期运行时重复打扰。
            if state.question_keys.len() >= MAX_FAILED_TURN_KEYS {
                state.question_keys.pop_front();
            }
            state.question_keys.push_back(key);
            match language {
                NotificationLanguage::ZhCn => "Task 有待回答的问题，请处理".to_owned(),
                NotificationLanguage::En => "Task has questions awaiting your answer".to_owned(),
            }
        }
        "turn.completed" => {
            let turn_key = turn_key(event_json)?;
            if remove_failed_turn(state, &turn_key) {
                return None;
            }
            match (
                language,
                event_json.pointer("/payload/turn/status")?.as_str()?,
            ) {
                (NotificationLanguage::ZhCn, "completed") => "Task 已完成".to_owned(),
                (NotificationLanguage::ZhCn, "failed") => "Task 运行失败".to_owned(),
                (NotificationLanguage::ZhCn, "interrupted") => "Task 已中断，无法继续".to_owned(),
                (NotificationLanguage::En, "completed") => "Task completed".to_owned(),
                (NotificationLanguage::En, "failed") => "Task failed".to_owned(),
                (NotificationLanguage::En, "interrupted") => {
                    "Task was interrupted and cannot continue".to_owned()
                }
                _ => return None,
            }
        }
        "provider.error"
            if event_json
                .pointer("/payload/willRetry")
                .and_then(serde_json::Value::as_bool)
                == Some(false) =>
        {
            if !remember_failed_turn(state, turn_key(event_json)?) {
                return None;
            }
            let message = event_json
                .pointer("/payload/message")
                .and_then(serde_json::Value::as_str)?;
            match language {
                NotificationLanguage::ZhCn => format!("Task 运行失败：{message}"),
                NotificationLanguage::En => format!("Task failed: {message}"),
            }
        }
        "pending_request.created" => {
            let is_user_input = event_json
                .pointer("/payload/request/type")
                .and_then(serde_json::Value::as_str)
                == Some("user_input");
            match (language, is_user_input) {
                (NotificationLanguage::ZhCn, true) => "Task 等待输入".to_owned(),
                (NotificationLanguage::ZhCn, false) => "Task 等待审批".to_owned(),
                (NotificationLanguage::En, true) => "Task is waiting for input".to_owned(),
                (NotificationLanguage::En, false) => "Task is waiting for approval".to_owned(),
            }
        }
        _ => return None,
    };
    let normalized_task_name = if task_name.trim().is_empty() {
        "Task"
    } else {
        task_name.trim()
    };
    Some(TaskNotification {
        identity: match event.event_type() {
            Some("pending_request.created") => event_json.pointer("/payload/request/requestId"),
            Some("item.completed") => event_json.pointer("/payload/item/id"),
            _ => None,
        }
        .and_then(serde_json::Value::as_str)
        .map(str::to_owned),
        body,
        route: tray_task_route(project_id, event.task_id()?).ok()?,
        title: format!("Codexly · {normalized_task_name}"),
    })
}

fn turn_key(event: &serde_json::Value) -> Option<String> {
    Some(format!(
        "{}:{}",
        event.get("taskId")?.as_str()?,
        event.get("turnId")?.as_str()?
    ))
}

fn remember_failed_turn(state: &mut NotificationState, turn_key: String) -> bool {
    if state.failed_turn_keys.iter().any(|key| key == &turn_key) {
        return false;
    }
    if state.failed_turn_keys.len() >= MAX_FAILED_TURN_KEYS {
        state.failed_turn_keys.pop_front();
    }
    state.failed_turn_keys.push_back(turn_key);
    true
}

fn remove_failed_turn(state: &mut NotificationState, turn_key: &str) -> bool {
    let Some(index) = state
        .failed_turn_keys
        .iter()
        .position(|key| key == turn_key)
    else {
        return false;
    };
    state.failed_turn_keys.remove(index);
    true
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{NotificationLanguage, NotificationState, reduce_task_notification};
    use crate::domain::runtime::AgentEvent;

    #[test]
    fn async_questions_should_notify_once() {
        let mut state = NotificationState::default();
        let event = AgentEvent::from(json!({
            "type": "item.completed", "taskId": "task-1", "turnId": "turn-1", "itemId": "q-1",
            "payload": { "item": { "id": "q-1", "type": "message", "role": "assistant", "questions": [{ "title": "运行方式", "options": [] }] } }
        }));
        assert!(super::is_notification_event(&event));
        let notification = reduce_task_notification(
            &mut state,
            &event,
            "project-1",
            "任务",
            NotificationLanguage::ZhCn,
        );
        assert_eq!(
            notification.map(|value| value.body),
            Some("Task 有待回答的问题，请处理".to_owned())
        );
        assert!(
            reduce_task_notification(
                &mut state,
                &event,
                "project-1",
                "任务",
                NotificationLanguage::ZhCn
            )
            .is_none()
        );
    }

    #[test]
    fn rust_maps_task_events_to_system_notifications() {
        let mut state = NotificationState::default();
        let event = AgentEvent::from(json!({
            "payload": {"turn": {"status": "completed"}},
            "taskId": "task-1",
            "turnId": "turn-1",
            "type": "turn.completed"
        }));

        assert_eq!(
            reduce_task_notification(
                &mut state,
                &event,
                "project-1",
                "修复底层通知",
                NotificationLanguage::ZhCn,
            ),
            Some(super::TaskNotification {
                identity: None,
                body: "Task 已完成".to_owned(),
                route: "p/project-1/t/task-1".to_owned(),
                title: "Codexly · 修复底层通知".to_owned(),
            })
        );

        let request = AgentEvent::from(json!({
            "payload": {"request": {"type": "user_input"}},
            "taskId": "task-1",
            "turnId": "turn-2",
            "type": "pending_request.created"
        }));
        assert_eq!(
            reduce_task_notification(
                &mut state,
                &request,
                "project-1",
                "修复底层通知",
                NotificationLanguage::ZhCn,
            )
            .map(|notification| notification.body),
            Some("Task 等待输入".to_owned())
        );
    }

    #[test]
    fn rust_deduplicates_provider_failure_and_terminal_event() {
        let mut state = NotificationState::default();
        let failed = AgentEvent::from(json!({
            "payload": {"message": "连接失败", "willRetry": false},
            "taskId": "task-1",
            "turnId": "turn-1",
            "type": "provider.error"
        }));
        let completed = AgentEvent::from(json!({
            "payload": {"turn": {"status": "failed"}},
            "taskId": "task-1",
            "turnId": "turn-1",
            "type": "turn.completed"
        }));

        assert!(
            reduce_task_notification(
                &mut state,
                &failed,
                "project-1",
                "任务",
                NotificationLanguage::ZhCn,
            )
            .is_some()
        );
        assert_eq!(
            reduce_task_notification(
                &mut state,
                &failed,
                "project-1",
                "任务",
                NotificationLanguage::ZhCn,
            ),
            None
        );
        assert_eq!(
            reduce_task_notification(
                &mut state,
                &completed,
                "project-1",
                "任务",
                NotificationLanguage::ZhCn,
            ),
            None
        );
    }
}
