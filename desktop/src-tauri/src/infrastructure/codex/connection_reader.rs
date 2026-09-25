use super::*;

pub(super) async fn read_responses<R>(
    reader: R,
    pending: PendingRequests,
    server_messages: ServerMessageSender,
    image_store: Option<GeneratedImageStore>,
    model_catalog: Arc<ModelCatalogCache>,
    connection_seq: u64,
) where
    R: AsyncRead + Unpin,
{
    let mut reader = BufReader::new(reader);
    let mut line = Vec::with_capacity(8 * 1024);
    let mut queued_notifications = NotificationBuffer::new(NOTIFICATION_OVERFLOW_CAPACITY);

    loop {
        line.clear();
        let read_result = {
            // 跨通知发送轮次保留同一个 Future，避免丢失已消费的半帧和图片扫描状态。
            let read = read_bounded_frame(
                &mut reader,
                &mut line,
                MAX_STANDARD_FRAME_BYTES,
                MAX_IMAGE_FRAME_BYTES,
            );
            tokio::pin!(read);
            loop {
                tokio::select! {
                    biased;
                    result = &mut read => break result,
                    permit = server_messages.reserve(queued_notifications.next_bytes()), if !queued_notifications.is_empty() => {
                        let Ok(permit) = permit else {
                            queued_notifications.clear();
                            continue;
                        };
                        permit.send(queued_notifications.pop_front().expect("queue is not empty"));
                    }
                }
            }
        };
        match read_result {
            Ok(false) => {
                record_read_failure(connection_seq, &pending, "eof", line.len(), None);
                fail_pending(&pending, PendingError::ConnectionClosed);
                // stdout 已关闭且不再有 response；尽量交付此前已接收的通知。
                while let Some(notification) = queued_notifications.pop_front() {
                    if server_messages.send(notification).await.is_err() {
                        break;
                    }
                }
                return;
            }
            Err(FrameReadError::Io(error)) => {
                record_read_failure(
                    connection_seq,
                    &pending,
                    "io",
                    line.len(),
                    Some(error.to_string()),
                );
                fail_pending(&pending, PendingError::ConnectionClosed);
                return;
            }
            Err(FrameReadError::TooLarge) => {
                record_read_failure(
                    connection_seq,
                    &pending,
                    "frame_too_large",
                    line.len(),
                    None,
                );
                fail_pending(&pending, PendingError::InvalidMessage);
                return;
            }
            Ok(true) => {}
        }

        while matches!(line.last(), Some(b'\r')) {
            line.pop();
        }
        if line.is_empty() {
            continue;
        }

        if let Some(store) = image_store.as_ref()
            && GeneratedImageStore::contains_image_generation(&line)
        {
            let store = store.clone();
            match tokio::task::spawn_blocking(move || store.sanitize_frame(line)).await {
                Ok(Ok(sanitized)) => line = sanitized,
                Ok(Err(_)) | Err(_) => {
                    record_read_failure(connection_seq, &pending, "image_frame_invalid", 0, None);
                    fail_pending(&pending, PendingError::InvalidMessage);
                    return;
                }
            }
        }

        // 只解析响应信封，result 保持 RawValue，避免大响应在路由阶段重复建树。
        let mut message = match serde_json::from_slice::<IncomingMessage>(&line) {
            Ok(message) => message,
            Err(_) => {
                record_read_failure(connection_seq, &pending, "invalid_json", line.len(), None);
                fail_pending(&pending, PendingError::InvalidMessage);
                return;
            }
        };
        if let Some(method) = message.method.take() {
            if matches!(
                method.as_str(),
                "account/updated" | "account/login/completed"
            ) {
                model_catalog.invalidate();
            }
            let Some(params) = message.params else {
                record_read_failure(connection_seq, &pending, "missing_params", line.len(), None);
                fail_pending(&pending, PendingError::InvalidMessage);
                return;
            };
            let mut notification = ServerMessage {
                id: message.id,
                method,
                params,
            };
            if queued_notifications.is_empty() {
                match server_messages.try_send(notification) {
                    Ok(()) => continue,
                    Err(mpsc::error::TrySendError::Full(returned)) => notification = returned,
                    Err(mpsc::error::TrySendError::Closed(_)) => continue,
                }
            }
            // 不等待通知消费，继续读取 RPC；事实流触达硬预算时显式失败，由 Runtime 恢复。
            if !queued_notifications.push(notification) {
                record_read_failure(
                    connection_seq,
                    &pending,
                    "notification_budget_exceeded",
                    line.len(),
                    None,
                );
                fail_pending(&pending, PendingError::InvalidMessage);
                return;
            }
            continue;
        }
        route_response(&pending, message);
    }
}

fn record_read_failure(
    connection_seq: u64,
    pending: &PendingRequests,
    reason: &str,
    frame_bytes: usize,
    message: Option<String>,
) {
    let pending_count = pending
        .lock()
        .map(|requests| requests.len())
        .unwrap_or_default();
    // 只记录信封级原因与字节数，解析失败也不回显可能包含提示词和凭据的原始帧。
    diagnostics::record(
        if reason == "eof" {
            diagnostics::DiagnosticLevel::Warn
        } else {
            diagnostics::DiagnosticLevel::Error
        },
        "codex_connection_read_failed",
        message,
        std::collections::BTreeMap::from([
            ("connectionSeq".to_owned(), connection_seq.into()),
            ("reason".to_owned(), reason.into()),
            ("pendingRequests".to_owned(), pending_count.into()),
            ("frameBytes".to_owned(), frame_bytes.into()),
        ]),
    );
}
