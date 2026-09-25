use serde::Serialize;
use serde_json::Value;

use crate::domain::runtime::{AgentDeltaType, AgentEvent};

pub(super) const MAX_ROWS: usize = 12;
pub(super) const MAX_TEXT_BYTES: usize = 4096;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct TaskWindowRow {
    pub id: String,
    pub kind: String,
    pub text: String,
}

#[derive(Debug, Serialize)]
pub struct TaskWindowUpdate {
    #[serde(flatten)]
    pub row: TaskWindowRow,
    pub append: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskWindowPacket {
    pub sequence: u64,
    pub title: String,
    pub status: String,
    pub order: Vec<String>,
    pub updates: Vec<TaskWindowUpdate>,
    pub truncated: bool,
}

#[derive(Default)]
pub(super) struct TaskWindowProjection {
    pub title: String,
    pub status: String,
    rows: Vec<TaskWindowRow>,
    sent: Vec<TaskWindowRow>,
    dirty: bool,
    truncated: bool,
    started_during_bootstrap: bool,
}

/// 仅保存末尾 UTF-8 文本；大工具输出不会随会话时长扩大原生或 WebView 内存。
fn tail(text: &str) -> &str {
    let mut start = text.len().saturating_sub(MAX_TEXT_BYTES);
    while !text.is_char_boundary(start) {
        start += 1;
    }
    &text[start..]
}

fn title_prefix(text: &str) -> &str {
    let end = text
        .char_indices()
        .nth(160)
        .map_or(text.len(), |(index, _)| index);
    &text[..end]
}

impl TaskWindowProjection {
    pub(super) fn seed(&mut self, mut snapshot: Self) {
        self.title = snapshot.title;
        if self.status.is_empty() {
            self.status = snapshot.status;
        }
        // 快照请求期间已经开始新回合时，历史页不能重新混入；实时项始终优先于迟到快照。
        if !self.started_during_bootstrap {
            snapshot
                .rows
                .retain(|old| !self.rows.iter().any(|live| live.id == old.id));
            snapshot.rows.append(&mut self.rows);
            let remove = snapshot.rows.len().saturating_sub(MAX_ROWS);
            snapshot.rows.drain(..remove);
            self.rows = snapshot.rows;
            self.truncated |= snapshot.truncated || remove > 0;
        }
        self.dirty = true;
    }

    pub(super) fn snapshot_item(&mut self, item: &crate::domain::conversation::AgentItem) {
        use crate::domain::conversation::AgentItem;
        // 直接借用快照字段，避免为了小窗摘要复制/序列化完整命令输出、工具 JSON 或文件 Diff。
        match item {
            AgentItem::Message {
                id,
                role: "assistant",
                text,
                ..
            } => self.upsert(id, "message", text, false),
            AgentItem::Plan { id, text } => self.upsert(id, "plan", text, false),
            AgentItem::Command { id, command, .. } => self.upsert(id, "command", command, false),
            AgentItem::Tool { id, name, .. } => self.upsert(id, "tool", name, false),
            AgentItem::Activity { id, label, .. } => self.upsert(id, "activity", label, false),
            AgentItem::FileChange { id, changes, .. } => {
                let text = changes
                    .iter()
                    .take(12)
                    .map(|change| title_prefix(&change.path))
                    .collect::<Vec<_>>()
                    .join("\n");
                self.upsert(id, "file_change", &text, false);
            }
            _ => {}
        }
    }
    fn upsert(&mut self, id: &str, kind: &str, text: &str, append: bool) {
        let index = self.rows.iter().position(|row| row.id == id);
        let index = index.unwrap_or_else(|| {
            if self.rows.len() == MAX_ROWS {
                self.rows.remove(0);
                self.truncated = true;
            }
            self.rows.push(TaskWindowRow {
                id: id.to_owned(),
                kind: kind.to_owned(),
                text: String::new(),
            });
            self.rows.len() - 1
        });
        let row = &mut self.rows[index];
        row.kind = kind.to_owned();
        // 操作只传单行标题，保留开头的命令/路径身份；内部日志与 Diff 不进入小窗通道。
        if matches!(kind, "command" | "tool" | "file_change" | "activity") {
            row.text = title_prefix(text)
                .chars()
                .map(|character| {
                    if character.is_whitespace() {
                        ' '
                    } else {
                        character
                    }
                })
                .collect();
            self.dirty = true;
            return;
        }
        if append {
            row.text.push_str(tail(text));
        } else {
            row.text = tail(text).to_owned();
        }
        if row.text.len() > MAX_TEXT_BYTES || text.len() > MAX_TEXT_BYTES {
            self.truncated = true;
            row.text = tail(&row.text).to_owned();
        }
        self.dirty = true;
    }

    pub(super) fn item(&mut self, item: &Value) {
        let Some(id) = item.get("id").and_then(Value::as_str) else {
            return;
        };
        let kind = item
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or("activity");
        let string = |key| item.get(key).and_then(Value::as_str).unwrap_or("");
        let text = match kind {
            "message" if string("role") == "assistant" => string("text"),
            "plan" => string("text"),
            "command" => string("command"),
            "tool" => string("name"),
            "activity" => string("label"),
            "file_change" => {
                let text = item
                    .get("changes")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .take(12)
                    .filter_map(|change| change.get("path").and_then(Value::as_str))
                    .map(title_prefix)
                    .collect::<Vec<_>>()
                    .join("\n");
                self.upsert(id, kind, &text, false);
                return;
            }
            _ => return,
        };
        if !text.is_empty() {
            self.upsert(id, kind, text, false);
        }
    }

    pub(super) fn set_status(&mut self, status: &str) {
        if self.status != status {
            self.status = status.to_owned();
            self.dirty = true;
        }
    }

    pub(super) fn apply(&mut self, event: &AgentEvent) {
        if let AgentEvent::Delta(delta) = event {
            let kind = match delta.event_type {
                AgentDeltaType::Message => "message",
                AgentDeltaType::Plan => "plan",
                // 小窗只保留回复与计划，推理摘要不计入正文。
                AgentDeltaType::Reasoning => return,
                // 执行输出量大，小窗只展示命令和工具摘要。
                _ => return,
            };
            self.upsert(&delta.item_id, kind, &delta.payload.delta, true);
            return;
        }
        let Some(value) = event.as_json() else {
            return;
        };
        match event.event_type() {
            Some("item.started" | "item.completed") => {
                if let Some(item) = value.pointer("/payload/item") {
                    self.item(item);
                }
            }
            Some("message.delta" | "plan.delta") => {
                let Some(id) = value.get("itemId").and_then(Value::as_str) else {
                    return;
                };
                let text = value
                    .pointer("/payload/delta")
                    .and_then(Value::as_str)
                    .unwrap_or("");
                let kind = event
                    .event_type()
                    .unwrap_or("message.delta")
                    .split('.')
                    .next()
                    .unwrap_or("message");
                self.upsert(id, kind, text, true);
            }
            Some("turn.started") => {
                self.started_during_bootstrap = true;
                self.rows.clear();
                self.truncated = false;
                self.dirty = true;
                self.set_status("running");
            }
            Some("turn.completed") => self.set_status(
                value
                    .pointer("/payload/turn/status")
                    .and_then(Value::as_str)
                    .unwrap_or("completed"),
            ),
            Some("task.status_updated") => self.set_status(
                value
                    .pointer("/payload/status")
                    .and_then(Value::as_str)
                    .unwrap_or("idle"),
            ),
            Some("pending_request.created") => self.set_status("waiting"),
            Some("pending_request.resolved" | "pending_request.expired") => {
                self.set_status("running")
            }
            Some("task.removed") => self.set_status("removed"),
            Some("provider.error") => self.set_status("failed"),
            _ => {}
        }
    }

    pub(super) fn packet(&mut self, sequence: u64, reset: bool) -> Option<TaskWindowPacket> {
        if !reset && !self.dirty {
            return None;
        }
        let updates = self
            .rows
            .iter()
            .filter_map(|row| {
                let previous = if reset {
                    None
                } else {
                    self.sent
                        .iter()
                        .find(|old| old.id == row.id && old.kind == row.kind)
                };
                if previous == Some(row) {
                    return None;
                }
                let suffix = previous.and_then(|old| row.text.strip_prefix(&old.text));
                Some(TaskWindowUpdate {
                    row: TaskWindowRow {
                        id: row.id.clone(),
                        kind: row.kind.clone(),
                        text: suffix.unwrap_or(&row.text).to_owned(),
                    },
                    append: suffix.is_some(),
                })
            })
            .collect();
        self.sent.clone_from(&self.rows);
        self.dirty = false;
        Some(TaskWindowPacket {
            sequence,
            title: self.title.clone(),
            status: self.status.clone(),
            order: self.rows.iter().map(|row| row.id.clone()).collect(),
            updates,
            truncated: self.truncated,
        })
    }
}
