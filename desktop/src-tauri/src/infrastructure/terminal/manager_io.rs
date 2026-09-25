use super::manager::{Entry, Registry, TerminalManager};
use crate::domain::project_terminal::{TerminalError, TerminalEvent, TerminalScope, validate_size};
use std::sync::atomic::Ordering;

impl Registry {
    fn scoped_entry(&self, scope: &TerminalScope) -> Result<&Entry, TerminalError> {
        if self.generation != scope.generation {
            return Err(TerminalError::ScopeMismatch);
        }
        let entry = self
            .entries
            .get(&scope.terminal_id)
            .ok_or(TerminalError::NotFound)?;
        if entry.project_id != scope.project_id {
            return Err(TerminalError::ScopeMismatch);
        }
        Ok(entry)
    }
}

impl TerminalManager {
    pub fn write(
        &self,
        scope: &TerminalScope,
        sequence: u64,
        bytes: &[u8],
    ) -> Result<(), TerminalError> {
        let transport = {
            let registry = self.lock();
            let entry = registry.scoped_entry(scope)?;
            if registry.closing || entry.cancelled.load(Ordering::Acquire) {
                return Err(TerminalError::OwnerClosing);
            }
            entry.transport.clone().ok_or(TerminalError::NotFound)?
        };
        transport.write(sequence, bytes)
    }

    pub fn ack(&self, scope: &TerminalScope, offset: u64) -> Result<(), TerminalError> {
        let transport = {
            let registry = self.lock();
            let entry = registry.scoped_entry(scope)?;
            if entry.transport.is_none() {
                // 退出事件可能先于 JS 尾部解析回调到达，最终偏移以内的累计 ACK 仍然有效。
                return if offset <= entry.final_offset {
                    Ok(())
                } else {
                    Err(TerminalError::StreamInvalid)
                };
            }
            entry.transport.clone().ok_or(TerminalError::NotFound)?
        };
        transport.ack(offset)
    }

    pub fn resize(&self, scope: &TerminalScope, cols: u16, rows: u16) -> Result<(), TerminalError> {
        validate_size(cols, rows)?;
        let (session, resize_lock) = {
            let registry = self.lock();
            let entry = registry.scoped_entry(scope)?;
            if registry.closing || entry.cancelled.load(Ordering::Acquire) {
                return Err(TerminalError::OwnerClosing);
            }
            (
                entry.session.clone().ok_or(TerminalError::NotFound)?,
                entry.resize_lock.clone(),
            )
        };
        // OS resize 与元数据更新共享会话级顺序，避免并发命令把旧尺寸写回快照。
        let _resize = resize_lock
            .lock()
            .map_err(|_| TerminalError::StreamInvalid)?;
        session.resize(cols, rows)?;
        let mut registry = self.lock();
        let entry = registry
            .entries
            .get_mut(&scope.terminal_id)
            .ok_or(TerminalError::NotFound)?;
        let metadata = entry.metadata.as_mut().ok_or(TerminalError::NotFound)?;
        if (metadata.cols, metadata.rows) != (cols, rows) && metadata.state.is_live() {
            metadata.cols = cols;
            metadata.rows = rows;
            let event = TerminalEvent::StateChanged(metadata.clone());
            registry.publish(event);
        }
        Ok(())
    }
}
