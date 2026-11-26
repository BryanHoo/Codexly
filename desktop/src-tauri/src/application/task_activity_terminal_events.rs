use super::{TaskActivityState, TaskActivityStatus, event_text};
use crate::domain::runtime::AgentEvent;

impl TaskActivityState {
    pub(in crate::application) fn acknowledge(&mut self, project_id: &str, task_id: &str) -> bool {
        self.acknowledge_at(project_id, task_id, None)
    }

    pub(in crate::application) fn acknowledge_at(
        &mut self,
        project_id: &str,
        task_id: &str,
        sequence: Option<u64>,
    ) -> bool {
        let Some(index) = self.activity_index(project_id, task_id) else {
            return false;
        };
        if matches!(
            self.activities[index].snapshot.status,
            TaskActivityStatus::Running | TaskActivityStatus::Waiting
        ) {
            return false;
        }
        // 切换任务时发出的确认可能迟到，不能消费随后结束的新回合。
        if let (Some(expected), Some(current)) =
            (sequence, self.activities[index].snapshot.terminal_sequence)
            && expected != current
        {
            return false;
        }
        self.activities.remove(index);
        true
    }

    pub(in crate::application) fn apply_event_for_viewed_task(
        &mut self,
        project_id: &str,
        event: &AgentEvent,
        task_is_viewed: bool,
    ) -> bool {
        let changed = self.apply_event(project_id, event);
        let terminal_event = match event.event_type() {
            Some("turn.completed") => true,
            Some("provider.error") => changed,
            Some("task.status_updated") => {
                changed
                    && matches!(
                        event_text(event, "/payload/status"),
                        Some("idle" | "failed")
                    )
            }
            _ => false,
        };
        if !terminal_event {
            return changed;
        }
        let Some(task_id) = event.task_id() else {
            return changed;
        };
        if task_is_viewed {
            return self.acknowledge(project_id, task_id) || changed;
        }
        // 摘要引用终态事件的序号，项目中其他任务的新事件不会改变已读身份。
        let sequence = event
            .as_json()
            .and_then(|event| event.get("sequence"))
            .and_then(serde_json::Value::as_u64);
        if let Some(index) = self.activity_index(project_id, task_id) {
            let snapshot = &mut self.activities[index].snapshot;
            let previous_sequence = std::mem::replace(&mut snapshot.terminal_sequence, sequence);
            return changed || previous_sequence != sequence;
        }
        changed
    }
}
