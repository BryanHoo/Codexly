use super::super::{
    app_lifecycle::visible_main_window_route,
    desktop_pet_commands::{desktop_pet_route_targets_task, render_desktop_pet_task_activities},
    notification_commands::observe_task_notification,
    task_subscription_commands::spawn_task_subscription_release,
    tray_commands::render_tray_task_activities,
};
use super::{RuntimeSession, prepare_event_delivery};
use crate::{
    domain::runtime::{AgentEvent, AppEvent},
    infrastructure::codex::PendingServerRequest,
};
use serde_json::{Value, json};
use std::sync::Arc;
use tauri::AppHandle;
use tokio::sync::Mutex;

pub(super) async fn publish_mapped_event(
    runtime: &Arc<Mutex<RuntimeSession>>,
    mut event: AgentEvent,
    mut pending: Option<PendingServerRequest>,
    app: Option<&AppHandle>,
) -> bool {
    let Some(task_id) = event.task_id().map(str::to_owned) else {
        return true;
    };
    let metadata_update = super::task_snapshot_metadata::MetadataUpdate::prepare(&event);
    let skill_message = super::task_skill_message::SkillMessage::prepare(&event);
    let visible_route = if event.event_type() == Some("turn.completed") {
        app.and_then(visible_main_window_route)
    } else {
        None
    };

    // 序号只在实际发布时分配，合并后的 delta 不会制造 checkpoint 空洞。
    let delivery = prepare_event_delivery(runtime).await;
    let mut session = runtime.lock().await;
    let Some(project_id) = session.task_projects.get(&task_id).cloned() else {
        return true;
    };
    if let Some(pending) = pending.as_mut() {
        pending.request["projectId"] = json!(project_id);
        let Some(event_json) = event.as_json_mut() else {
            return true;
        };
        event_json["payload"]["request"]["projectId"] = json!(project_id);
    }
    let task_is_viewed = visible_route
        .as_deref()
        .is_some_and(|route| desktop_pet_route_targets_task(route, &project_id, &task_id));
    session
        .task_failure_projection
        .observe(&project_id, &mut event);
    session
        .task_skill_projection
        .observe(&project_id, &mut event, skill_message);
    let activity_changed =
        session
            .task_activity
            .apply_event_for_viewed_task(&project_id, &event, task_is_viewed);
    let release_generation = if event.event_type() == Some("turn.started") {
        session.task_subscription_leases.retain(&task_id);
        None
    } else if is_terminal_task_event(&event) {
        Some(session.task_subscription_leases.release(&task_id))
    } else {
        None
    };
    let task_name = session.task_activity.task_name(&task_id).map(str::to_owned);
    let task_activities = activity_changed.then(|| session.task_activity.snapshot());
    if event.event_type() == Some("task.removed") {
        session.task_projects.remove(&task_id);
    }
    let sequence = session
        .project_sequences
        .entry(project_id.clone())
        .or_default();
    *sequence += 1;
    event.set_sequence(*sequence);
    if let Some(update) = metadata_update {
        session
            .task_snapshot_metadata
            .observe(&project_id, &task_id, update);
    }
    if event.event_type() == Some("turn.started")
        && let Some(turn) = event
            .as_json()
            .and_then(|event| event.pointer("/payload/turn"))
    {
        session.turn_started_waiters.resolve(&task_id, turn);
    }
    if let Some(pending) = pending {
        let Some(request_id) = pending
            .request
            .get("requestId")
            .and_then(Value::as_str)
            .map(str::to_owned)
        else {
            return true;
        };
        session.pending_requests.insert(request_id, pending);
    }
    // 原生登记不等待 WebView ACK；传输预算耗尽时显式通知快照恢复。
    let pet_event = event.clone();
    let provider_event_count = event.source_event_count();
    let event_sender = session.event_sender.clone();
    let queue_depth = event_sender
        .as_ref()
        .map_or(0, |sender| sender.queue_depth());
    session
        .performance_metrics
        .record_delivery(&project_id, provider_event_count, 1, queue_depth);
    let diagnostic_connection = super::event_diagnostics::is_diagnostic_event(&event)
        .then(|| {
            session
                .codex_process
                .as_ref()
                .map(|process| process.connection().diagnostic_seq())
        })
        .flatten();
    drop(session);
    super::event_diagnostics::record_task_event(&event, &project_id, diagnostic_connection);
    if let Some(app) = app {
        // 原生状态已完成投影；即使窗口已销毁，仍更新托盘、宠物和通知。
        if let Some(task_activities) = task_activities.as_deref() {
            if let Err(error) = render_tray_task_activities(app, task_activities) {
                crate::infrastructure::diagnostics::record_error(
                    "runtime_event_tray_update_failed",
                    error,
                );
            }
            if let Err(error) = render_desktop_pet_task_activities(app, task_activities).await {
                crate::infrastructure::diagnostics::record_error(
                    "runtime_event_desktop_pet_update_failed",
                    error,
                );
            }
        }
        observe_task_notification(app, &pet_event, &project_id, task_name.as_deref()).await;
        if let Some(generation) = release_generation {
            // 终态释放由 Rust 事件源触发，窗口销毁后仍会持续处理 busy 重试。
            spawn_task_subscription_release(
                app.clone(),
                project_id.clone(),
                task_id.clone(),
                generation,
            );
        }
    }
    delivery.send(AppEvent::AgentEvent { event }).await;
    true
}

fn is_terminal_task_event(event: &AgentEvent) -> bool {
    match event.event_type() {
        Some("turn.completed") => true,
        Some("provider.error") => {
            event
                .as_json()
                .and_then(|event| event.pointer("/payload/willRetry"))
                .and_then(Value::as_bool)
                == Some(false)
        }
        Some("task.status_updated") => {
            event
                .as_json()
                .and_then(|event| event.pointer("/payload/status"))
                .and_then(Value::as_str)
                == Some("failed")
        }
        _ => false,
    }
}
