use std::{
    collections::HashMap,
    io::{self, Write},
};

use serde_json::Value;

use crate::domain::{conversation::AgentTaskSnapshot, runtime::AgentEvent};

const MAX_TASKS: usize = 256;
const MAX_BYTES: usize = 4 * 1_048_576;
const MAX_FIELD_BYTES: usize = 262_144;

#[derive(Default)]
struct Metadata {
    project_id: String,
    usage: Option<RetainedValue>,
    plan: Option<RetainedValue>,
    bytes: usize,
    touched: u64,
}

pub(super) struct RetainedValue {
    value: Value,
    bytes: usize,
}

pub(super) enum MetadataUpdate {
    Usage(Option<RetainedValue>),
    Plan(Option<RetainedValue>),
    Removed,
}

impl MetadataUpdate {
    pub(super) fn prepare(event: &AgentEvent) -> Option<Self> {
        // token 热路径不解析、不序列化、不复制消息正文。
        let (field, is_usage) = match event.event_type()? {
            "usage.updated" => ("usage", true),
            "plan.updated" => ("plan", false),
            "task.removed" => return Some(Self::Removed),
            _ => return None,
        };
        let value = event.as_json()?.get("payload")?.get(field)?;
        let mut counter = ByteCounter(0);
        // 在全局锁外计数；超限立即停止，避免为巨大计划构建临时 JSON 字符串。
        let retained = (!value.is_null() && serde_json::to_writer(&mut counter, value).is_ok())
            .then(|| RetainedValue {
                value: value.clone(),
                bytes: counter.0,
            });
        Some(if is_usage {
            Self::Usage(retained)
        } else {
            Self::Plan(retained)
        })
    }
}

struct ByteCounter(usize);

impl Write for ByteCounter {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if bytes.len() > MAX_FIELD_BYTES.saturating_sub(self.0) {
            return Err(io::Error::other(
                "Task snapshot metadata exceeds its byte budget",
            ));
        }
        self.0 += bytes.len();
        Ok(bytes.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

/// 仅保存历史 API 缺失的最后一份用量和计划，不复制正文或事件历史。
#[derive(Default)]
pub(super) struct TaskSnapshotMetadata {
    tasks: HashMap<String, Metadata>,
    bytes: usize,
    clock: u64,
}

impl TaskSnapshotMetadata {
    pub(super) fn observe(&mut self, project_id: &str, task_id: &str, update: MetadataUpdate) {
        let (is_usage, value) = match update {
            MetadataUpdate::Usage(value) => (true, value),
            MetadataUpdate::Plan(value) => (false, value),
            MetadataUpdate::Removed => {
                self.remove(task_id);
                return;
            }
        };
        self.clock += 1;
        let entry = self.tasks.entry(task_id.to_owned()).or_default();
        self.bytes -= entry.bytes;
        if entry.project_id != project_id {
            *entry = Metadata {
                project_id: project_id.to_owned(),
                ..Metadata::default()
            };
        }
        // 超大更新清除旧值，不能把旧计划伪装成当前事实。
        if is_usage {
            entry.usage = value;
        } else {
            entry.plan = value;
        }
        entry.touched = self.clock;
        entry.bytes = task_id.len()
            + entry.project_id.len()
            + entry.usage.as_ref().map_or(0, |value| value.bytes)
            + entry.plan.as_ref().map_or(0, |value| value.bytes);
        self.bytes += entry.bytes;
        while self.tasks.len() > MAX_TASKS || self.bytes > MAX_BYTES {
            let oldest = self
                .tasks
                .iter()
                .min_by_key(|(_, entry)| entry.touched)
                .map(|(id, _)| id.clone());
            if let Some(id) = oldest {
                self.remove(&id);
            } else {
                break;
            }
        }
    }

    pub(super) fn apply(&mut self, snapshot: &mut AgentTaskSnapshot) {
        let Some(entry) = self
            .tasks
            .get_mut(&snapshot.id)
            .filter(|entry| entry.project_id == snapshot.project_id)
        else {
            return;
        };
        self.clock += 1;
        entry.touched = self.clock;
        snapshot.context_usage = entry.usage.as_ref().map(|value| value.value.clone());
        snapshot.plan = entry.plan.as_ref().map(|value| value.value.clone());
    }

    fn remove(&mut self, task_id: &str) {
        if let Some(entry) = self.tasks.remove(task_id) {
            self.bytes -= entry.bytes;
        }
    }

    pub(super) fn forget_project(&mut self, project_id: &str) {
        self.tasks.retain(|_, entry| {
            if entry.project_id == project_id {
                self.bytes -= entry.bytes;
                false
            } else {
                true
            }
        });
    }

    pub(super) fn clear(&mut self) {
        *self = Self::default();
    }
}

#[cfg(test)]
#[path = "task_snapshot_metadata_tests.rs"]
mod tests;
