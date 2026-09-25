use std::{
    collections::HashMap,
    sync::{Mutex, MutexGuard},
};

use tauri::ipc::Channel;

use super::{
    error::AppError,
    task_window_stream::{TaskWindowPacket, TaskWindowProjection},
};
use crate::domain::runtime::{AppEvent, RuntimeStatus};

#[derive(Default)]
pub(super) struct TaskWindowRuntime {
    inner: Mutex<Registry>,
}

#[derive(Default)]
struct Registry {
    next_label: u64,
    entries: HashMap<String, Entry>,
}

struct Entry {
    project_id: String,
    task_id: String,
    projection: TaskWindowProjection,
    channel: Option<Channel<TaskWindowPacket>>,
    sequence: u64,
    in_flight: Option<u64>,
    initialized: bool,
    ready: bool,
}

impl Entry {
    fn flush(&mut self, reset: bool) {
        if !self.initialized || self.in_flight.is_some() {
            return;
        }
        let Some(channel) = &self.channel else {
            return;
        };
        let sequence = self.sequence + 1;
        let Some(packet) = self.projection.packet(sequence, reset) else {
            return;
        };
        self.sequence = sequence;
        // 每窗最多一个未确认包；页面慢或隐藏时只覆盖有界投影，不积压 IPC。
        if channel.send(packet).is_ok() {
            self.in_flight = Some(sequence);
        } else {
            self.channel = None;
        }
    }
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

impl TaskWindowRuntime {
    fn lock(&self) -> MutexGuard<'_, Registry> {
        self.inner
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    pub(super) fn reserve(
        &self,
        project_id: &str,
        task_id: &str,
    ) -> Result<(String, bool), AppError> {
        if !valid_id(project_id) || !valid_id(task_id) {
            return Err(AppError::TaskWindowFailed);
        }
        let mut registry = self.lock();
        if let Some((label, _)) = registry
            .entries
            .iter()
            .find(|(_, entry)| entry.project_id == project_id && entry.task_id == task_id)
        {
            return Ok((label.clone(), false));
        }
        if registry.entries.len() >= 3 {
            return Err(AppError::TaskWindowLimit);
        }
        registry.next_label += 1;
        let label = format!("task-window-{}", registry.next_label);
        registry.entries.insert(
            label.clone(),
            Entry {
                project_id: project_id.to_owned(),
                task_id: task_id.to_owned(),
                projection: TaskWindowProjection::default(),
                channel: None,
                sequence: 0,
                in_flight: None,
                initialized: false,
                ready: false,
            },
        );
        Ok((label, true))
    }

    pub(super) fn contains_task(&self, task_id: &str) -> bool {
        self.lock()
            .entries
            .values()
            .any(|entry| entry.task_id == task_id)
    }

    pub(super) fn remove(&self, label: &str) -> Option<(String, String)> {
        self.lock()
            .entries
            .remove(label)
            .map(|entry| (entry.project_id, entry.task_id))
    }

    pub(super) fn route(&self, label: &str) -> Result<String, AppError> {
        let registry = self.lock();
        let entry = registry
            .entries
            .get(label)
            .ok_or(AppError::TaskWindowFailed)?;
        Ok(if entry.project_id == "temporary" {
            format!("temporary/t/{}", entry.task_id)
        } else {
            format!("p/{}/t/{}", entry.project_id, entry.task_id)
        })
    }

    pub(super) fn initialize(&self, label: &str, projection: TaskWindowProjection) {
        if let Some(entry) = self.lock().entries.get_mut(label) {
            entry.projection.seed(projection);
            entry.initialized = true;
            entry.flush(true);
        }
    }

    pub(super) fn mark_ready(&self, label: &str) -> bool {
        let mut registry = self.lock();
        let Some(entry) = registry.entries.get_mut(label) else {
            return false;
        };
        entry.ready = true;
        entry.channel.is_some()
    }

    pub(super) fn connect(
        &self,
        label: &str,
        channel: Channel<TaskWindowPacket>,
    ) -> Result<bool, AppError> {
        let mut registry = self.lock();
        let entry = registry
            .entries
            .get_mut(label)
            .ok_or(AppError::TaskWindowFailed)?;
        entry.channel = Some(channel);
        entry.in_flight = None;
        entry.flush(true);
        Ok(entry.ready)
    }

    pub(super) fn acknowledge(&self, label: &str, sequence: u64) -> Result<(), AppError> {
        let mut registry = self.lock();
        let entry = registry
            .entries
            .get_mut(label)
            .ok_or(AppError::TaskWindowFailed)?;
        if entry.in_flight == Some(sequence) {
            entry.in_flight = None;
            entry.flush(false);
        }
        Ok(())
    }

    pub(super) fn observe(&self, event: &AppEvent) {
        let mut registry = self.lock();
        for entry in registry.entries.values_mut() {
            match event {
                AppEvent::AgentEvent { event }
                    if event.task_id() == Some(entry.task_id.as_str()) =>
                {
                    entry.projection.apply(event)
                }
                AppEvent::RuntimeStatus {
                    status: RuntimeStatus::Failed | RuntimeStatus::Stopped,
                    ..
                } => entry.projection.set_status("disconnected"),
                AppEvent::ResyncRequired { project_id, .. } if project_id == &entry.project_id => {
                    entry.projection.set_status("disconnected")
                }
                _ => continue,
            }
            entry.flush(false);
        }
    }
}
