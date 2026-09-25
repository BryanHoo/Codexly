use crate::domain::project_terminal::{
    BLOCK_BYTES, OUTPUT_HIGH_BYTES, OUTPUT_LOW_BYTES, TerminalError,
};
use std::{
    collections::VecDeque,
    sync::{Condvar, Mutex},
};

#[derive(Default)]
struct FlowState {
    sent: u64,
    acknowledged: u64,
    sequence: u64,
    paused: bool,
    cancelled: bool,
    frames: VecDeque<u64>,
}

#[derive(Default)]
pub(super) struct FlowControl {
    state: Mutex<FlowState>,
    wake: Condvar,
}

impl FlowControl {
    pub fn read_budget(&self) -> Result<usize, TerminalError> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| TerminalError::StreamInvalid)?;
        if state.sent - state.acknowledged >= OUTPUT_HIGH_BYTES || state.frames.len() >= 1024 {
            state.paused = true;
        }
        // 只有解析后的累计 ACK 降到低水位才恢复；Channel.send 成功不能增加额度。
        while state.paused && !state.cancelled {
            state = self
                .wake
                .wait(state)
                .map_err(|_| TerminalError::StreamInvalid)?;
        }
        if state.cancelled {
            return Err(TerminalError::OwnerClosing);
        }
        Ok(
            (OUTPUT_HIGH_BYTES - (state.sent - state.acknowledged)).min(BLOCK_BYTES as u64)
                as usize,
        )
    }

    pub fn sent(&self, bytes: usize) -> Result<(u64, u64), TerminalError> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| TerminalError::StreamInvalid)?;
        if state.cancelled {
            return Err(TerminalError::OwnerClosing);
        }
        if bytes == 0
            || bytes > BLOCK_BYTES
            || state.frames.len() >= 1024
            || state.sent - state.acknowledged + bytes as u64 > OUTPUT_HIGH_BYTES
        {
            return Err(TerminalError::StreamInvalid);
        }
        state.sent = state
            .sent
            .checked_add(bytes as u64)
            .ok_or(TerminalError::StreamInvalid)?;
        state.sequence = state
            .sequence
            .checked_add(1)
            .ok_or(TerminalError::StreamInvalid)?;
        // 字节预算之外限制未确认帧数，避免单字节输出撑大 IPC 消息元数据。
        let offset = state.sent;
        state.frames.push_back(offset);
        if state.sent - state.acknowledged >= OUTPUT_HIGH_BYTES || state.frames.len() >= 1024 {
            state.paused = true;
        }
        Ok((state.sequence, state.sent))
    }

    pub fn ack(&self, parsed: u64) -> Result<(), TerminalError> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| TerminalError::StreamInvalid)?;
        if parsed > state.sent {
            return Err(TerminalError::StreamInvalid);
        }
        if parsed <= state.acknowledged {
            return Ok(());
        }
        state.acknowledged = parsed;
        while state.frames.front().is_some_and(|offset| *offset <= parsed) {
            state.frames.pop_front();
        }
        if state.sent - parsed <= OUTPUT_LOW_BYTES && state.frames.len() <= 256 {
            state.paused = false;
            self.wake.notify_all();
        }
        Ok(())
    }

    pub fn final_offset(&self) -> u64 {
        self.state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .sent
    }
    #[cfg(any(test, feature = "webview-tests"))]
    pub fn outstanding(&self) -> u64 {
        let state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        state.sent - state.acknowledged
    }
    pub fn cancel(&self) {
        self.state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .cancelled = true;
        self.wake.notify_all();
    }
}
