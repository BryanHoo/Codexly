use super::*;

// WinRT 同步调用只能进入有界阻塞池，批量通知也不能扩张为每条一个阻塞线程。
static IO_LIMIT: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(2);

pub(super) async fn deliver(
    app: &AppHandle,
    notification: TaskNotification,
    id: u64,
    token: &CancellationToken,
) {
    if token.is_cancelled() {
        return;
    }
    let app_id = if tauri::is_dev() {
        tauri_winrt_notification::Toast::POWERSHELL_APP_ID.to_owned()
    } else {
        app.config().identifier.clone()
    };
    let (sender, response) = tokio::sync::oneshot::channel();
    let sender = Mutex::new(Some(sender));
    let permit = tokio::select! {
        _ = token.cancelled() => return,
        permit = IO_LIMIT.acquire() => match permit { Ok(permit) => permit, Err(_) => return },
    };
    let active = token.clone();
    // WinRT 初始化和发送隔离到阻塞池，不占据运行时事件处理线程；内部没有固定延迟。
    let route = notification.route;
    let shown = tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit;
        if active.is_cancelled() {
            return Ok(None);
        }
        windows_process_platform::TaskNotificationHandle::show(
            &app_id,
            &format!("{id:016x}"),
            &notification.title,
            &notification.body,
            move |clicked| {
                if let Some(sender) = sender
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner)
                    .take()
                {
                    let _ = sender.send(clicked);
                }
            },
        )
        .map(Some)
    })
    .await;
    let handle = match shown {
        Ok(Ok(Some(handle))) => handle,
        Ok(Ok(None)) => return,
        Ok(Err(error)) => {
            crate::infrastructure::diagnostics::record_error(
                "task_notification_show_failed",
                error,
            );
            return;
        }
        Err(error) => {
            crate::infrastructure::diagnostics::record_error(
                "task_notification_show_failed",
                error,
            );
            return;
        }
    };
    tokio::select! {
        _ = token.cancelled() => {},
        _ = tokio::time::sleep(MAX_NOTIFICATION_LIFETIME) => {},
        result = response => { if result == Ok(true) { show_main_window_at_route(app, route); } },
    }
    // Drop 撤销全部事件 token 并移除对应历史，不在异步执行线程调用 WinRT 清理。
    if let Ok(permit) = IO_LIMIT.acquire().await {
        let _ = tauri::async_runtime::spawn_blocking(move || {
            let _permit = permit;
            drop(handle);
        })
        .await;
    }
}
