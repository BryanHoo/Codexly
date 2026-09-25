use crate::domain::project_terminal::{BLOCK_BYTES, INPUT_QUEUE_BYTES, TerminalError};
use std::{
    collections::VecDeque,
    sync::{Condvar, Mutex},
};

#[derive(Default)]
struct InputState {
    queue: VecDeque<Vec<u8>>,
    bytes: usize,
    sequence: u64,
    cancelled: bool,
}
#[derive(Default)]
pub(super) struct InputQueue {
    state: Mutex<InputState>,
    wake: Condvar,
}

impl InputQueue {
    pub fn accept(&self, sequence: u64, bytes: &[u8]) -> Result<(), TerminalError> {
        if bytes.is_empty() || bytes.len() > BLOCK_BYTES {
            return Err(TerminalError::InputTooLarge);
        }
        let mut state = self
            .state
            .lock()
            .map_err(|_| TerminalError::StreamInvalid)?;
        if state.cancelled {
            return Err(TerminalError::OwnerClosing);
        }
        if sequence == 0 {
            return Err(TerminalError::InputSequenceGap);
        }
        if sequence <= state.sequence {
            return Ok(());
        }
        if state.sequence.checked_add(1) != Some(sequence) {
            return Err(TerminalError::InputSequenceGap);
        }
        if state.bytes + bytes.len() > INPUT_QUEUE_BYTES || state.queue.len() >= 256 {
            return Err(TerminalError::InputQueueFull);
        }
        state.bytes += bytes.len();
        state.sequence = sequence;
        state.queue.push_back(bytes.to_vec());
        self.wake.notify_one();
        Ok(())
    }

    pub fn take(&self) -> Option<Vec<u8>> {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        while state.queue.is_empty() && !state.cancelled {
            state = self
                .wake
                .wait(state)
                .unwrap_or_else(std::sync::PoisonError::into_inner);
        }
        if state.cancelled {
            None
        } else {
            state.queue.pop_front()
        }
    }

    pub fn consumed(&self, bytes: usize) {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        // 队列预算包含正在写入 OS 的块，不能在 dequeue 时提前释放这部分额度。
        state.bytes = state.bytes.saturating_sub(bytes);
    }

    #[cfg(any(test, feature = "webview-tests"))]
    pub fn bytes(&self) -> usize {
        self.state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .bytes
    }
    pub fn cancel(&self) {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        state.cancelled = true;
        state.queue.clear();
        state.bytes = 0;
        self.wake.notify_all();
    }
}
