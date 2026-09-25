use std::collections::{HashMap, HashSet};

use serde_json::Value;

use super::task_skill_message::{MAX_ENTRY_BYTES, SkillMessage};
use crate::domain::{
    conversation::{AgentItem, AgentTaskSnapshot},
    conversation_skills::normalize_skill_fields,
    runtime::AgentEvent,
};

const MAX_TASKS: usize = 128;
const MAX_BYTES: usize = 8 * 1_048_576;
const MAX_ALIASES: usize = 128;

struct Record {
    project: String,
    turn: String,
    message: SkillMessage,
    aliases: HashSet<String>,
    adjacent: bool,
    touched: u64,
}

impl Record {
    fn bytes(&self, task: &str) -> usize {
        task.len()
            + self.project.len()
            + self.turn.len()
            + self.message.bytes()
            + self.aliases.iter().map(String::len).sum::<usize>()
    }
}

/// 每任务保留最近用户项的轻量投影；生命周期别名指回原消息，迟到 completed 不产生新气泡。
#[derive(Default)]
pub(super) struct TaskSkillProjection {
    tasks: HashMap<String, Record>,
    bytes: usize,
    clock: u64,
}

impl TaskSkillProjection {
    pub fn observe(
        &mut self,
        project: &str,
        event: &mut AgentEvent,
        prepared: Option<SkillMessage>,
    ) {
        if let AgentEvent::Delta(delta) = event {
            self.block(project, &delta.task_id, &delta.turn_id);
            return;
        }
        let Some(json) = event.as_json_mut() else {
            return;
        };
        let Some(task) = json["taskId"].as_str() else {
            return;
        };
        if json["type"] == "task.removed" {
            self.remove(task);
            return;
        }
        let Some(turn) = json["turnId"].as_str() else {
            return;
        };
        let kind = json["type"].as_str().unwrap_or_default();
        if matches!(
            kind,
            "message.delta" | "plan.delta" | "command.output_delta" | "file_change.updated"
        ) {
            self.block(project, task, turn);
            return;
        }
        if !matches!(
            kind,
            "item.started" | "item.completed" | "turn.started" | "turn.completed"
        ) {
            return;
        }
        if task.len() > 1024 || turn.len() > 1024 || project.len() > 1024 {
            return;
        }
        let (task, turn) = (task.to_owned(), turn.to_owned());
        if kind.starts_with("turn.") {
            if self
                .tasks
                .get(&task)
                .is_some_and(|record| record.project != project || record.turn != turn)
            {
                if kind == "turn.completed" {
                    return;
                }
                self.remove(&task);
            }
            if let Some(record) = self.tasks.get_mut(&task) {
                apply_json_turn(record, &mut json["payload"]["turn"]);
                if json["type"] == "turn.completed" {
                    record.adjacent = false;
                } else if let Some(last) = json["payload"]["turn"]["items"]
                    .as_array()
                    .and_then(|items| items.last())
                {
                    record.adjacent &= last["id"] == record.message.id;
                }
            } else if json["type"] == "turn.started"
                && let Some(message) = prepared
            {
                self.insert(
                    task,
                    Record {
                        project: project.into(),
                        turn,
                        message,
                        aliases: HashSet::new(),
                        adjacent: true,
                        touched: 0,
                    },
                );
            }
            return;
        }
        if json["payload"]["item"]["type"] != "message" || json["payload"]["item"]["role"] != "user"
        {
            self.block(project, &task, &turn);
            return;
        }
        // Codex 用户项先 started 后 completed；没有已知身份的迟到完成不能建立新关联。
        if json["type"] == "item.completed"
            && !self.tasks.get(&task).is_some_and(|record| {
                record.project == project
                    && record.turn == turn
                    && json["payload"]["item"]["id"]
                        .as_str()
                        .is_some_and(|id| id == record.message.id || record.aliases.contains(id))
            })
        {
            return;
        }
        let Some(mut message) = prepared else {
            self.remove(&task);
            return;
        };
        if message.expansion
            && self
                .tasks
                .get(&task)
                .is_some_and(|record| record.project != project || record.turn != turn)
        {
            return;
        }
        let previous = self
            .remove(&task)
            .filter(|record| record.project == project && record.turn == turn);
        if let Some(mut record) = previous {
            if message.expansion && record.message.id != message.id {
                let known = record.aliases.contains(&message.id);
                if (record.adjacent || known)
                    && (known || record.aliases.len() < MAX_ALIASES)
                    && record.bytes(&task) + message.id.len() + message.bytes() <= MAX_ENTRY_BYTES
                    && record.message.merge(&message.skills)
                {
                    record.aliases.insert(message.id);
                    json["type"] = "message.skills_updated".into();
                    json["itemId"] = record.message.id.clone().into();
                    json["payload"] = record.message.payload();
                } else {
                    // 独立展开项已经进入时间线，后续新项不能越过它继续归并。
                    record.adjacent = false;
                }
                // 无法可靠关联时原样投递，不把独立内容并入旧用户项。
                self.insert(task, record);
                return;
            }
            if record.message.id == message.id {
                if !message.merge(&record.message.skills) {
                    return;
                }
                json["payload"]["item"]["text"] = message.text.clone().into();
                if !message.skills.is_empty() {
                    json["payload"]["item"]["skills"] = Value::Array(message.skills.clone());
                }
                record.message = message;
                self.insert(task, record);
                return;
            }
        }
        self.insert(
            task,
            Record {
                project: project.into(),
                turn,
                message,
                aliases: HashSet::new(),
                adjacent: true,
                touched: 0,
            },
        );
    }

    fn block(&mut self, project: &str, task: &str, turn: &str) {
        if let Some(record) = self
            .tasks
            .get_mut(task)
            .filter(|record| record.project == project && record.turn == turn)
        {
            record.adjacent = false;
        }
    }

    pub fn apply(&mut self, snapshot: &mut AgentTaskSnapshot) {
        let Some(record) = self
            .tasks
            .get_mut(&snapshot.id)
            .filter(|record| record.project == snapshot.project_id)
        else {
            return;
        };
        if record.message.skills.is_empty() {
            return;
        }
        let Some(turn) = snapshot
            .turns
            .iter_mut()
            .find(|turn| turn.id == record.turn)
        else {
            return;
        };
        let Some(AgentItem::Message {text, skills, ..}) = turn.items.iter_mut().find(|item| matches!(item, AgentItem::Message {id, role:"user", ..} if id == &record.message.id)) else { return };
        let skills = skills.get_or_insert_with(Vec::new);
        skills.extend_from_slice(&record.message.skills);
        normalize_skill_fields(text, skills);
        turn.items.retain(|item| !matches!(item, AgentItem::Message {id, skill_expansion:true, ..} if record.aliases.contains(id)));
        self.clock += 1;
        record.touched = self.clock;
    }

    pub fn seed(&mut self, snapshot: &AgentTaskSnapshot, message: Option<SkillMessage>) {
        if self.tasks.contains_key(&snapshot.id)
            || snapshot.id.len() > 1024
            || snapshot.project_id.len() > 1024
        {
            return;
        }
        let Some(turn) = snapshot
            .turns
            .last()
            .filter(|turn| turn.status == "running" && turn.id.len() <= 1024)
        else {
            return;
        };
        let Some(message) = message else { return };
        self.insert(
            snapshot.id.clone(),
            Record {
                project: snapshot.project_id.clone(),
                turn: turn.id.clone(),
                message,
                aliases: HashSet::new(),
                adjacent: true,
                touched: 0,
            },
        );
    }

    fn insert(&mut self, task: String, mut record: Record) {
        self.remove(&task);
        let bytes = record.bytes(&task);
        if bytes > MAX_ENTRY_BYTES {
            return;
        }
        self.clock += 1;
        record.touched = self.clock;
        self.bytes += bytes;
        self.tasks.insert(task, record);
        while self.tasks.len() > MAX_TASKS || self.bytes > MAX_BYTES {
            let Some(task) = self
                .tasks
                .iter()
                .min_by_key(|(_, record)| record.touched)
                .map(|(task, _)| task.clone())
            else {
                break;
            };
            self.remove(&task);
        }
    }

    fn remove(&mut self, task: &str) -> Option<Record> {
        let record = self.tasks.remove(task)?;
        self.bytes -= record.bytes(task);
        Some(record)
    }

    pub fn forget_project(&mut self, project: &str) {
        self.tasks.retain(|task, record| {
            if record.project == project {
                self.bytes -= record.bytes(task);
                false
            } else {
                true
            }
        });
    }

    pub fn clear(&mut self) {
        *self = Self::default();
    }
}

fn apply_json_turn(record: &Record, turn: &mut Value) {
    if record.message.skills.is_empty() {
        return;
    }
    let Some(items) = turn["items"].as_array_mut() else {
        return;
    };
    let Some(item) = items.iter_mut().find(|item| {
        item["id"] == record.message.id && item["type"] == "message" && item["role"] == "user"
    }) else {
        return;
    };
    let Some(text) = item["text"].as_str() else {
        return;
    };
    let mut text = text.to_owned();
    let mut skills = item["skills"].as_array().cloned().unwrap_or_default();
    skills.extend_from_slice(&record.message.skills);
    normalize_skill_fields(&mut text, &mut skills);
    item["text"] = text.into();
    if !skills.is_empty() {
        item["skills"] = skills.into();
    }
    items.retain(|item| {
        !item["id"]
            .as_str()
            .is_some_and(|id| record.aliases.contains(id) && item["skillExpansion"] == true)
    });
}

#[cfg(test)]
#[path = "task_skill_projection_tests.rs"]
mod tests;
