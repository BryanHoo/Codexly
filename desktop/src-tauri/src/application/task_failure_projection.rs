use std::collections::HashMap;

use serde_json::Value;

use crate::domain::{conversation::AgentTaskSnapshot, runtime::AgentEvent};

const MAX_TASKS: usize = 128;
const MAX_BYTES: usize = 1_048_576;
const MAX_ENTRY_BYTES: usize = 65_536;

struct Failure {
    project_id: String,
    turn_id: String,
    message: String,
    bytes: usize,
    touched: u64,
}

/// 保留每个任务最近一轮的失败原因；不复制消息正文，也不建立第二份历史库。
#[derive(Default)]
pub(super) struct TaskFailureProjection {
    failures: HashMap<String, Failure>,
    bytes: usize,
    clock: u64,
}

impl TaskFailureProjection {
    pub(super) fn observe(&mut self, project_id: &str, event: &mut AgentEvent) {
        // delta 热路径直接退出，不扫描文本、不分配临时缓冲区。
        if !matches!(
            event.event_type(),
            Some("provider.error" | "turn.started" | "turn.completed" | "task.removed")
        ) {
            return;
        }
        let Some(event) = event.as_json_mut() else {
            return;
        };
        let Some(task_id) = event["taskId"].as_str() else {
            return;
        };
        if event["type"] == "task.removed" {
            self.remove(task_id);
            return;
        }
        let Some(turn_id) = event["turnId"].as_str() else {
            return;
        };
        let matching = self
            .failures
            .get(task_id)
            .filter(|failure| failure.project_id == project_id && failure.turn_id == turn_id);
        match event["type"].as_str() {
            Some("turn.started") => {
                // 延迟到达的同轮启动事件不能清除错误；新轮开始释放上一轮补充信息。
                if matching.is_none() {
                    self.remove(task_id);
                }
            }
            Some("provider.error") => {
                if event["payload"]["willRetry"] == false {
                    if let Some(message) = event["payload"]["message"].as_str() {
                        self.retain(project_id, task_id, turn_id, message);
                    }
                } else if matching.is_some() {
                    self.remove(task_id);
                }
            }
            Some("turn.completed") => {
                let turn = &event["payload"]["turn"];
                if turn["status"] != "failed" {
                    if matching.is_some() {
                        self.remove(task_id);
                    }
                } else if let Some(message) = turn["error"].as_str() {
                    // 上游终态明确给出的原因优先，后续窗口恢复也使用同一个结果。
                    self.retain(project_id, task_id, turn_id, message);
                } else if turn["error"].is_null()
                    && let Some(failure) = matching
                {
                    event["payload"]["turn"]["error"] = Value::String(failure.message.clone());
                }
            }
            _ => {}
        }
    }

    pub(super) fn apply(&mut self, snapshot: &mut AgentTaskSnapshot) {
        let Some(failure) = self
            .failures
            .get_mut(&snapshot.id)
            .filter(|failure| failure.project_id == snapshot.project_id)
        else {
            return;
        };
        // 只补齐同轮失败的缺失正文；不从缓存推断历史状态或覆盖上游明确错误。
        for turn in &mut snapshot.turns {
            if turn.id == failure.turn_id && turn.status == "failed" && turn.error.is_none() {
                turn.error = Some(failure.message.clone());
                self.clock += 1;
                failure.touched = self.clock;
            }
        }
    }

    fn retain(&mut self, project_id: &str, task_id: &str, turn_id: &str, message: &str) {
        self.remove(task_id);
        let bytes = project_id
            .len()
            .saturating_add(task_id.len())
            .saturating_add(turn_id.len())
            .saturating_add(message.len());
        // 超限仍原样投递当前事件，但不保留旧错误冒充新结果；在复制字符串前检查预算。
        if bytes > MAX_ENTRY_BYTES {
            return;
        }
        self.clock += 1;
        self.failures.insert(
            task_id.to_owned(),
            Failure {
                project_id: project_id.to_owned(),
                turn_id: turn_id.to_owned(),
                message: message.to_owned(),
                bytes,
                touched: self.clock,
            },
        );
        self.bytes += bytes;
        while self.failures.len() > MAX_TASKS || self.bytes > MAX_BYTES {
            let Some(oldest) = self
                .failures
                .iter()
                .min_by_key(|(_, failure)| failure.touched)
                .map(|(task, _)| task.clone())
            else {
                break;
            };
            self.remove(&oldest);
        }
    }

    fn remove(&mut self, task_id: &str) {
        if let Some(failure) = self.failures.remove(task_id) {
            self.bytes -= failure.bytes;
        }
    }

    pub(super) fn forget_project(&mut self, project_id: &str) {
        self.failures.retain(|_, failure| {
            if failure.project_id == project_id {
                self.bytes -= failure.bytes;
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
#[path = "task_failure_projection_tests.rs"]
mod tests;
