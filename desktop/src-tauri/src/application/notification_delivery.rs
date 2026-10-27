use super::{
    app_lifecycle::show_main_window_at_route,
    notification_commands::{NotificationRuntime, TaskNotification},
};
use std::{
    collections::VecDeque,
    sync::{
        LazyLock, Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};
use tauri::{AppHandle, Manager};
use tokio_util::sync::CancellationToken;

#[cfg(all(unix, not(target_os = "macos")))]
mod linux;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
mod windows;

const MAX_SYSTEM_NOTIFICATIONS: usize = 64;
const MAX_NOTIFICATION_LIFETIME: Duration = Duration::from_secs(24 * 60 * 60);
static NOTIFICATION_SEQUENCE: LazyLock<AtomicU64> =
    LazyLock::new(|| AtomicU64::new(uuid::Uuid::new_v4().as_u64_pair().0));

pub(crate) fn initialize(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    {
        let clicked_app = app.clone();
        if let Err(error) =
            macos_panel_activation::initialize_notifications(move |route, clicked| {
                clear(&clicked_app, Some(&route));
                if clicked {
                    show_main_window_at_route(&clicked_app, route);
                }
            })
        {
            crate::infrastructure::diagnostics::record_error(
                "task_notification_initialize_failed",
                error,
            );
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = app;
}

pub(crate) fn clear(app: &AppHandle, route: Option<&str>) {
    app.state::<NotificationRuntime>().deliveries.clear(route);
}

pub(super) fn send(app: &AppHandle, notification: TaskNotification) {
    let token = app
        .state::<NotificationRuntime>()
        .deliveries
        .register_identity(&notification.route, notification.identity.clone());
    if token.is_cancelled() {
        return;
    }
    let app = app.clone();
    let id = NOTIFICATION_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    // 全平台仅保存有界的异步观察资源；替换、已读、禁用和过期都会取消，不占用线程等待点击。
    tauri::async_runtime::spawn(async move {
        #[cfg(target_os = "macos")]
        macos::deliver(&app, notification, id, &token).await;
        #[cfg(target_os = "windows")]
        windows::deliver(&app, notification, id, &token).await;
        #[cfg(all(unix, not(target_os = "macos")))]
        linux::deliver(&app, notification, id, &token).await;
        token.cancel();
    });
}

#[derive(Default)]
pub(super) struct DeliveryRegistry {
    state: Mutex<DeliveryState>,
}

struct DeliveryEntry {
    route: String,
    identity: Option<String>,
    token: CancellationToken,
}
struct DeliveryState {
    enabled: bool,
    entries: VecDeque<DeliveryEntry>,
}
impl Default for DeliveryState {
    fn default() -> Self {
        Self {
            enabled: true,
            entries: VecDeque::new(),
        }
    }
}

impl DeliveryRegistry {
    pub(super) fn set_enabled(&self, enabled: bool) {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        state.enabled = enabled;
        if !enabled {
            for entry in state.entries.drain(..) {
                entry.token.cancel();
            }
        }
    }
    #[cfg(test)]
    pub(super) fn register(&self, route: &str) -> CancellationToken {
        self.register_identity(route, None)
    }
    pub(super) fn register_identity(
        &self,
        route: &str,
        identity: Option<String>,
    ) -> CancellationToken {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let token = CancellationToken::new();
        if !state.enabled {
            token.cancel();
            return token;
        }
        let entries = &mut state.entries;
        entries.retain(|entry| {
            if entry.route == route {
                entry.token.cancel();
            }
            !entry.token.is_cancelled()
        });
        if entries.len() >= MAX_SYSTEM_NOTIFICATIONS
            && let Some(entry) = entries.pop_front()
        {
            entry.token.cancel();
        }
        entries.push_back(DeliveryEntry {
            route: route.to_owned(),
            identity,
            token: token.clone(),
        });
        token
    }

    pub(super) fn clear(&self, route: Option<&str>) {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        state.entries.retain(|entry| {
            if route.is_none_or(|route| route == entry.route) {
                entry.token.cancel();
            }
            !entry.token.is_cancelled()
        });
    }

    pub(super) fn resolve(&self, route: &str, identity: &str) {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        state.entries.retain(|entry| {
            if entry.route == route && entry.identity.as_deref() == Some(identity) {
                entry.token.cancel();
            }
            !entry.token.is_cancelled()
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolving_an_older_request_preserves_the_latest_question_notification() {
        let registry = DeliveryRegistry::default();
        let latest = registry.register_identity("task", Some("new-question".to_owned()));
        registry.resolve("task", "old-question");
        assert!(!latest.is_cancelled());
        registry.resolve("task", "new-question");
        assert!(latest.is_cancelled());
    }

    #[test]
    fn disabling_notifications_also_rejects_late_in_flight_sends() {
        let registry = DeliveryRegistry::default();
        let existing = registry.register("task-a");
        registry.set_enabled(false);
        assert!(existing.is_cancelled());
        assert!(registry.register("late-event").is_cancelled());
        registry.set_enabled(true);
        assert!(!registry.register("new-event").is_cancelled());
    }

    #[test]
    fn replacing_a_task_cancels_only_its_previous_notification() {
        let registry = DeliveryRegistry::default();
        let old = registry.register("task-a");
        let other = registry.register("task-b");
        let latest = registry.register("task-a");
        assert!(old.is_cancelled());
        assert!(!other.is_cancelled());
        assert!(!latest.is_cancelled());
    }

    #[test]
    fn notification_resources_remain_bounded_and_can_be_released() {
        let registry = DeliveryRegistry::default();
        let oldest = registry.register("oldest");
        for index in 0..MAX_SYSTEM_NOTIFICATIONS {
            registry.register(&index.to_string());
        }
        assert!(oldest.is_cancelled());
        let latest = registry.register("latest");
        registry.clear(None);
        assert!(latest.is_cancelled());
    }

    #[test]
    fn acknowledging_one_task_preserves_other_task_notifications() {
        let registry = DeliveryRegistry::default();
        let first = registry.register("task-a");
        let second = registry.register("task-b");
        registry.clear(Some("task-a"));
        assert!(first.is_cancelled());
        assert!(!second.is_cancelled());
    }
}
