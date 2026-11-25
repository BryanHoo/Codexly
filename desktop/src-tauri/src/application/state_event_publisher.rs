use super::super::{
    app_lifecycle::visible_main_window_route,
    desktop_pet_commands::{desktop_pet_route_targets_task, render_desktop_pet_task_activities},
    notification_commands::observe_task_notification,
    tray_commands::render_tray_task_activities,
};
use super::{RuntimeSession, prepare_event_delivery};
use crate::domain::runtime::{AgentEvent, AppEvent};
use serde_json::Value;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;

pub(super) async fn publish_mapped_event(
    runtime: &Arc<Mutex<RuntimeSession>>,
    event: AgentEvent,
    app: Option<&AppHandle>,
) -> bool {
    publish_mapped_event_at_boundary(runtime, event, app, || {}).await
}

/// 在原生事实已投递、窗口及通知后处理尚未开始时确认边界，供宿主正确跟踪终态。
pub(super) async fn publish_mapped_event_at_boundary(
    runtime: &Arc<Mutex<RuntimeSession>>,
    mut event: AgentEvent,
    app: Option<&AppHandle>,
    published: impl FnOnce(),
) -> bool {
    let Some(task_id) = event.task_id().map(str::to_owned) else {
        return true;
    };
    let visible_route = if is_terminal_task_event(&event)
        || (event.event_type() == Some("task.status_updated")
            && event
                .as_json()
                .and_then(|event| event.pointer("/payload/status"))
                .and_then(Value::as_str)
                == Some("idle"))
    {
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
    let task_is_viewed = visible_route
        .as_deref()
        .is_some_and(|route| desktop_pet_route_targets_task(route, &project_id, &task_id));
    let sequence = session
        .project_sequences
        .entry(project_id.clone())
        .or_default();
    *sequence += 1;
    event.set_sequence(*sequence);
    let activity_changed =
        session
            .task_activity
            .apply_event_for_viewed_task(&project_id, &event, task_is_viewed);
    let task_name = session.task_activity.task_name(&task_id).map(str::to_owned);
    let task_activities = activity_changed.then(|| session.task_activity.snapshot());
    if event.event_type() == Some("task.removed") {
        session.task_projects.remove(&task_id);
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
    drop(session);
    // 先完成有序投递并释放顺序锁，原生窗口和通知不得延迟 WebView 收到事件。
    delivery.send(AppEvent::AgentEvent { event }).await;
    published();
    super::event_diagnostics::record_task_event(&pet_event, &project_id, None);
    if let Some(app) = app {
        // 原生状态已完成投影；即使窗口已销毁，仍更新托盘、宠物和通知。
        if let Some(task_activities) = task_activities.as_deref() {
            // 全局状态变更独立于项目事件订阅；窗口重新加载后通过轻量快照补齐。
            if let Err(error) = app.emit("task-activity://changed", ()) {
                crate::infrastructure::diagnostics::record_error(
                    "task_activity_notify_failed",
                    error,
                );
            }
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
    }
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
