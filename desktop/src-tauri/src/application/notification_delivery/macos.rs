use super::*;

pub(super) async fn deliver(
    app: &AppHandle,
    notification: TaskNotification,
    id: u64,
    token: &CancellationToken,
) {
    if token.is_cancelled() {
        return;
    }
    let identifier = format!("{id}:{}", notification.route);
    let failed = token.clone();
    let active = token.clone();
    if let Err(error) = macos_panel_activation::show_notification(
        &identifier,
        &notification.title,
        &notification.body,
        move || !active.is_cancelled(),
        move |error| {
            failed.cancel();
            crate::infrastructure::diagnostics::record_error(
                "task_notification_show_failed",
                error,
            );
        },
    ) {
        crate::infrastructure::diagnostics::record_error("task_notification_show_failed", error);
        return;
    }
    let _ = app;
    tokio::select! {
        _ = token.cancelled() => {},
        _ = tokio::time::sleep(MAX_NOTIFICATION_LIFETIME) => {},
    }
    macos_panel_activation::close_notification(&identifier);
}
