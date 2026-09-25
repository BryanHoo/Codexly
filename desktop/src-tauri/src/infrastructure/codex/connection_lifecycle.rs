use super::*;

/// 登记与请求 Future 同生共灭，超时、取消和提前返回均同步清理。
pub(super) struct PendingRegistration<'a> {
    pending: &'a PendingRequests,
    id: u64,
}

impl<'a> PendingRegistration<'a> {
    pub(super) fn new(
        pending: &'a PendingRequests,
        id: u64,
        sender: oneshot::Sender<PendingResult>,
    ) -> Result<Self, ConnectionError> {
        pending
            .lock()
            .map_err(|_| ConnectionError::StateUnavailable)?
            .insert(id, sender);
        Ok(Self { pending, id })
    }
}

impl Drop for PendingRegistration<'_> {
    fn drop(&mut self) {
        self.pending
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .remove(&self.id);
    }
}

/// 仅在已取得写锁后启用；排队取消不会破坏正在发送的其他请求。
struct InFlightWrite<'a> {
    slot: &'a mut Option<AsyncWriter>,
    connection: &'a AppServerConnection,
    complete: bool,
}

impl Drop for InFlightWrite<'_> {
    fn drop(&mut self) {
        if self.complete {
            return;
        }
        // write_all/flush 中断时无法保证 JSONL 帧完整：在释放写锁前永久撤销 writer。
        // 同步关闭写端并唤醒已有请求，停止读取任务让 Runtime 感知连接断开。
        diagnostics::record(
            diagnostics::DiagnosticLevel::Warn,
            "codex_connection_write_aborted",
            None,
            std::collections::BTreeMap::from([(
                "connectionSeq".to_owned(),
                self.connection.diagnostic_seq.into(),
            )]),
        );
        self.slot.take();
        fail_pending(&self.connection.pending, PendingError::ConnectionClosed);
        self.connection.reader_task.abort();
    }
}

impl AppServerConnection {
    pub(super) async fn write_message(&self, message: &[u8]) -> Result<(), ConnectionError> {
        self.write_message_tracked(message, None).await
    }

    pub(super) async fn write_message_tracked(
        &self,
        message: &[u8],
        mut phase: Option<&mut &'static str>,
    ) -> Result<(), ConnectionError> {
        if let Some(phase) = phase.as_deref_mut() {
            *phase = "write_queue";
        }
        let mut slot = self.writer.lock().await;
        if slot.is_none() {
            return Err(ConnectionError::ConnectionClosed);
        }
        let mut write = InFlightWrite {
            slot: &mut slot,
            connection: self,
            complete: false,
        };
        let writer = write
            .slot
            .as_mut()
            .ok_or(ConnectionError::ConnectionClosed)?;
        if let Some(phase) = phase.as_deref_mut() {
            *phase = "write";
        }
        writer.write_all(message).await?;
        if let Some(phase) = phase {
            *phase = "flush";
        }
        writer.flush().await?;
        write.complete = true;
        Ok(())
    }
}
