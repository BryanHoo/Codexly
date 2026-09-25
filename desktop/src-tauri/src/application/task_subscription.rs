use std::{collections::HashMap, time::Duration};

const MAX_PENDING_TASK_RELEASES: usize = 256;
const MAX_RETRY_DELAY_SECONDS: u64 = 30;

#[derive(Debug, Default)]
pub(super) struct TaskSubscriptionLeases {
    generations: HashMap<String, u64>,
    next_generation: u64,
}

impl TaskSubscriptionLeases {
    pub(super) fn complete(&mut self, task_id: &str, generation: u64) {
        if self.is_current(task_id, generation) {
            self.generations.remove(task_id);
        }
    }

    pub(super) fn is_current(&self, task_id: &str, generation: u64) -> bool {
        self.generations.get(task_id) == Some(&generation)
    }

    pub(super) fn release(&mut self, task_id: &str) -> u64 {
        if !self.generations.contains_key(task_id)
            && self.generations.len() >= MAX_PENDING_TASK_RELEASES
            && let Some(oldest_task_id) = self.generations.keys().next().cloned()
        {
            self.generations.remove(&oldest_task_id);
        }
        self.next_generation = self.next_generation.wrapping_add(1).max(1);
        self.generations
            .insert(task_id.to_owned(), self.next_generation);
        self.next_generation
    }

    pub(super) fn retain(&mut self, task_id: &str) {
        self.generations.remove(task_id);
    }
}

pub(super) fn unsubscribe_retry_delay(attempt: u32) -> Duration {
    let seconds = 1_u64
        .checked_shl(attempt.min(30))
        .unwrap_or(MAX_RETRY_DELAY_SECONDS)
        .min(MAX_RETRY_DELAY_SECONDS);
    Duration::from_secs(seconds)
}
