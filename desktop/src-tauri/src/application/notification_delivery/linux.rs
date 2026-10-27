use super::*;

pub(super) async fn deliver(
    app: &AppHandle,
    notification: TaskNotification,
    _id: u64,
    token: &CancellationToken,
) {
    let mut native = notify_rust::Notification::new();
    native
        .summary(&notification.title)
        .body(&notification.body)
        .action("default", "Open")
        // 使用系统关闭信号释放资源；应用侧取消与总期限保护不遵守超时约定的通知服务。
        .timeout(notify_rust::Timeout::Milliseconds(10_000));
    let handle = tokio::select! {
        _ = token.cancelled() => return,
        result = tokio::time::timeout(Duration::from_secs(10), native.show_async()) => match result {
            Ok(Ok(handle)) => handle,
            Ok(Err(error)) => { crate::infrastructure::diagnostics::record_error("task_notification_show_failed", error); return; },
            Err(error) => { crate::infrastructure::diagnostics::record_error("task_notification_show_timeout", error); return; },
        },
    };
    let route = notification.route;
    tokio::select! {
        _ = token.cancelled() => {},
        _ = tokio::time::sleep(MAX_NOTIFICATION_LIFETIME) => {},
        _ = handle.wait_for_action_async(|response| {
            if matches!(response, notify_rust::NotificationResponse::Default | notify_rust::NotificationResponse::Action(_)) {
                show_main_window_at_route(app, route);
            }
        }) => {},
    }
    let _ = tokio::time::timeout(Duration::from_secs(2), handle.close_async()).await;
}
