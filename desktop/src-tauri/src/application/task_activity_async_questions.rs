use std::collections::HashSet;

use crate::domain::conversation::{AgentItem, AgentTaskSnapshot};
use crate::domain::runtime::AgentEvent;

use super::{TaskActivityState, TaskActivityStatus};

#[derive(Clone, Debug, Default)]
pub(super) struct AsyncQuestions {
    pending: Vec<(String, Vec<String>)>,
    resolved: HashSet<String>,
}

pub(crate) fn is_question_event(event: &AgentEvent) -> bool {
    event.event_type() == Some("item.completed")
        && event
            .as_json()
            .and_then(|value| value.pointer("/payload/item"))
            .is_some_and(|item| {
                item["type"] == "message"
                    && item["role"] == "assistant"
                    && item["questions"]
                        .as_array()
                        .is_some_and(|questions| !questions.is_empty())
            })
}

impl AsyncQuestions {
    pub(super) fn is_pending(&self) -> bool {
        !self.pending.is_empty()
    }

    fn observe(&mut self, event: &AgentEvent) -> bool {
        let Some(item) = event
            .as_json()
            .and_then(|value| value.pointer("/payload/item"))
        else {
            return false;
        };
        if is_question_event(event) {
            let Some(id) = item["id"].as_str() else {
                return false;
            };
            if self.resolved.contains(id) || self.pending.iter().any(|(key, _)| key == id) {
                return false;
            }
            let titles = item["questions"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|question| question["title"].as_str().map(str::to_owned))
                .collect();
            self.pending.push((id.to_owned(), titles));
            return true;
        }
        if item["type"] != "message" || item["role"] != "user" {
            return false;
        }
        let Some(text) = item["text"].as_str() else {
            return false;
        };
        // 只识别问答表单生成的完整回答，普通用户消息不能提前清除待回答状态。
        let Some(index) = self
            .pending
            .iter()
            .rposition(|(_, titles)| matches_answer(titles, text))
        else {
            return false;
        };
        let (id, _) = self.pending.remove(index);
        self.resolved.insert(id);
        true
    }

    fn resolve(&mut self, id: &str) -> bool {
        self.resolved.insert(id.to_owned());
        let before = self.pending.len();
        self.pending.retain(|(key, _)| key != id);
        before != self.pending.len()
    }
}

fn matches_answer(titles: &[String], text: &str) -> bool {
    let mut remainder = text.trim();
    for (index, title) in titles.iter().enumerate() {
        let prefix = format!(
            "{}\n",
            if index == 0 {
                title.trim_start()
            } else {
                title
            }
        );
        let Some(rest) = remainder.strip_prefix(&prefix) else {
            return false;
        };
        remainder = rest;
        let Some(next) = titles.get(index + 1) else {
            return !remainder.trim().is_empty();
        };
        let boundary = format!("\n\n{next}\n");
        let Some(offset) = remainder.find(&boundary) else {
            return false;
        };
        if remainder[..offset].trim().is_empty() {
            return false;
        }
        remainder = &remainder[offset + 2..];
    }
    false
}

impl TaskActivityState {
    pub(crate) fn remember_async_question_snapshot(
        &mut self,
        snapshot: &AgentTaskSnapshot,
    ) -> bool {
        if snapshot.status != "running" {
            return false;
        }
        let record = self.ensure_activity(&snapshot.project_id, &snapshot.id);
        let previous = record.snapshot.status;
        for turn in snapshot
            .turns
            .iter()
            .filter(|turn| turn.status == "running")
        {
            for item in &turn.items {
                if let AgentItem::Message {
                    id,
                    role: "assistant",
                    questions: Some(questions),
                    ..
                } = item
                {
                    if questions.is_empty()
                        || record.async_questions.resolved.contains(id)
                        || record
                            .async_questions
                            .pending
                            .iter()
                            .any(|(key, _)| key == id)
                    {
                        continue;
                    }
                    record.async_questions.pending.push((
                        id.clone(),
                        questions
                            .iter()
                            .map(|question| question.title.clone())
                            .collect(),
                    ));
                } else if let AgentItem::Message {
                    role: "user", text, ..
                } = item
                    && let Some(index) = record
                        .async_questions
                        .pending
                        .iter()
                        .rposition(|(_, titles)| matches_answer(titles, text))
                {
                    let (id, _) = record.async_questions.pending.remove(index);
                    record.async_questions.resolved.insert(id);
                }
            }
        }
        // 同一份恢复快照可能同时包含问题与回答，扫描后按剩余待处理集合收敛状态。
        record.snapshot.status =
            if record.async_questions.is_pending() || !record.pending_request_ids.is_empty() {
                TaskActivityStatus::Waiting
            } else {
                TaskActivityStatus::Running
            };
        previous != record.snapshot.status
    }

    pub(super) fn remember_running_activity(
        &mut self,
        project_id: &str,
        task_id: &str,
        started_at: Option<&str>,
    ) {
        let record = self.ensure_activity(project_id, task_id);
        record.snapshot.status = if record.async_questions.is_pending() {
            TaskActivityStatus::Waiting
        } else {
            TaskActivityStatus::Running
        };
        record.pending_request_ids.clear();
        record.approval_request_ids.clear();
        record.refresh_approval_state();
        if let Some(started_at) = started_at {
            record.snapshot.started_at = Some(started_at.to_owned());
        }
    }

    pub(super) fn apply_async_question_event(
        &mut self,
        project_id: &str,
        task_id: &str,
        event: &AgentEvent,
    ) -> bool {
        if !is_question_event(event) && self.activity_index(project_id, task_id).is_none() {
            return false;
        }
        let record = self.ensure_activity(project_id, task_id);
        if !record.async_questions.observe(event) {
            return false;
        }
        record.snapshot.status =
            if record.async_questions.is_pending() || !record.pending_request_ids.is_empty() {
                TaskActivityStatus::Waiting
            } else {
                TaskActivityStatus::Running
            };
        true
    }

    pub(crate) fn resolve_async_question(
        &mut self,
        project_id: &str,
        task_id: &str,
        id: &str,
    ) -> bool {
        let Some(index) = self.activity_index(project_id, task_id) else {
            return false;
        };
        let record = &mut self.activities[index];
        if !record.async_questions.resolve(id) {
            return false;
        }
        if !record.async_questions.is_pending()
            && record.pending_request_ids.is_empty()
            && record.snapshot.status == TaskActivityStatus::Waiting
        {
            record.snapshot.status = TaskActivityStatus::Running;
        }
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::conversation::{AgentTaskSettings, AgentThreadConfiguration, AgentTurn};
    use serde_json::json;

    #[test]
    fn async_snapshot_should_clear_answered_waiting() {
        let mut state = TaskActivityState::default();
        state.apply_event("p", &AgentEvent::from(json!({
            "type": "item.completed", "taskId": "t",
            "payload": { "item": { "id": "q", "type": "message", "role": "assistant", "questions": [{ "title": "范围" }] } }
        })));
        let snapshot = AgentTaskSnapshot {
            engine: None,
            workspace_path: None,
            context_usage: None,
            goal: None,
            id: "t".into(),
            pending_requests: vec![],
            pinned: false,
            plan: None,
            project_id: "p".into(),
            settings: AgentTaskSettings::default(),
            thread_configuration: AgentThreadConfiguration {
                model: None,
                reasoning_effort: None,
            },
            status: "running",
            title: "任务".into(),
            turns_next_cursor: None,
            updated_at: "2026-10-23T00:00:00Z".into(),
            turns: vec![AgentTurn {
                process_cursor: None,
                completed_at: None,
                error: None,
                id: "turn".into(),
                item_timings: None,
                started_at: None,
                status: "running",
                items: vec![AgentItem::Message {
                    identity_aliases: vec![],
                    attachments: None,
                    id: "answer".into(),
                    phase: None,
                    questions: None,
                    role: "user",
                    skill_expansion: false,
                    skills: None,
                    text: "范围\n当前文件".into(),
                }],
            }],
        };
        assert!(state.remember_async_question_snapshot(&snapshot));
        assert_eq!(state.snapshot()[0].status, TaskActivityStatus::Running);
    }
}
