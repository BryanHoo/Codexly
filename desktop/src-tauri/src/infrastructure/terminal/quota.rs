use crate::domain::project_terminal::{GLOBAL_SESSIONS, PROJECT_SESSIONS, TerminalError};
use std::collections::HashMap;

#[derive(Default)]
pub(super) struct Quotas {
    projects: HashMap<String, usize>,
    total: usize,
}

impl Quotas {
    pub fn reserve(&mut self, project: &str) -> Result<(), TerminalError> {
        if self.total >= GLOBAL_SESSIONS
            || self.projects.get(project).copied().unwrap_or(0) >= PROJECT_SESSIONS
        {
            return Err(TerminalError::LimitReached);
        }
        *self.projects.entry(project.to_owned()).or_default() += 1;
        self.total += 1;
        Ok(())
    }

    pub fn release(&mut self, project: &str) {
        let Some(count) = self.projects.get_mut(project) else {
            return;
        };
        *count -= 1;
        self.total -= 1;
        if *count == 0 {
            self.projects.remove(project);
        }
    }

    pub fn total(&self) -> usize {
        self.total
    }
}
