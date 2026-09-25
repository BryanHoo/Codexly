use std::collections::{HashMap, HashSet};

use serde::Serialize;

use crate::domain::runtime::AgentEvent;

const MAX_TASK_ACTIVITIES: usize = 256;
const MAX_TASK_METADATA: usize = 2_048;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TaskActivityStatus {
    Completed,
    Failed,
    Running,
    Waiting,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskActivitySnapshot {
    pub(super) project_id: String,
    pub(super) requires_approval: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) root_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) started_at: Option<String>,
    pub(super) status: TaskActivityStatus,
    pub(super) task_id: String,
    pub(super) task_name: String,
}

#[derive(Clone, Debug)]
struct TaskMetadata {
    project_id: String,
    root_path: Option<String>,
    task_name: String,
}

#[derive(Clone, Debug)]
struct TaskActivityRecord {
    approval_request_ids: HashSet<String>,
    pending_request_ids: HashSet<String>,
    snapshot: TaskActivitySnapshot,
}

impl TaskActivityRecord {
    fn clear_pending_requests(&mut self) {
        self.approval_request_ids.clear();
        self.pending_request_ids.clear();
        self.snapshot.requires_approval = false;
    }

    fn refresh_approval_state(&mut self) {
        self.snapshot.requires_approval = !self.approval_request_ids.is_empty();
    }
}

#[derive(Debug, Default)]
pub(super) struct TaskActivityState {
    activities: Vec<TaskActivityRecord>,
    metadata: HashMap<String, TaskMetadata>,
    project_roots: HashMap<String, String>,
}

impl TaskActivityState {
    pub(super) fn acknowledge(&mut self, project_id: &str, task_id: &str) -> bool {
        let Some(index) = self.activity_index(project_id, task_id) else {
            return false;
        };
        if matches!(
            self.activities[index].snapshot.status,
            TaskActivityStatus::Running | TaskActivityStatus::Waiting
        ) {
            return false;
        }
        self.activities.remove(index);
        true
    }

    pub(super) fn fail_active(&mut self) -> bool {
        let mut changed = false;
        for record in &mut self.activities {
            if matches!(
                record.snapshot.status,
                TaskActivityStatus::Running | TaskActivityStatus::Waiting
            ) {
                record.snapshot.status = TaskActivityStatus::Failed;
                record.clear_pending_requests();
                changed = true;
            }
        }
        changed
    }

    pub(super) fn apply_event(&mut self, project_id: &str, event: &AgentEvent) -> bool {
        let Some(task_id) = event.task_id() else {
            return false;
        };
        match event.event_type() {
            Some("task.metadata_changed") => {
                let title = event
                    .as_json()
                    .and_then(|event| event.pointer("/payload/title"))
                    .and_then(serde_json::Value::as_str);
                self.update_title(project_id, task_id, title)
            }
            Some("task.removed") => self.remove_task(project_id, task_id),
            Some("turn.started") => {
                let started_at = event_text(event, "/payload/turn/startedAt")
                    .or_else(|| event_text(event, "/timestamp"))
                    .map(str::to_owned);
                let inserted = self.activity_index(project_id, task_id).is_none();
                let record = self.ensure_activity(project_id, task_id);
                let changed = inserted
                    || record.snapshot.status != TaskActivityStatus::Running
                    || !record.pending_request_ids.is_empty()
                    || record.snapshot.started_at != started_at;
                record.snapshot.status = TaskActivityStatus::Running;
                record.snapshot.started_at = started_at;
                record.clear_pending_requests();
                changed
            }
            Some("pending_request.created") => {
                let request_id = event_text(event, "/payload/request/requestId").map(str::to_owned);
                let requires_approval = event_text(event, "/payload/request/type")
                    .is_some_and(is_approval_request_type);
                let record = self.ensure_activity(project_id, task_id);
                let mut changed = record.snapshot.status != TaskActivityStatus::Waiting;
                record.snapshot.status = TaskActivityStatus::Waiting;
                if let Some(request_id) = request_id {
                    changed |= record.pending_request_ids.insert(request_id.clone());
                    if requires_approval {
                        changed |= record.approval_request_ids.insert(request_id);
                    }
                }
                record.refresh_approval_state();
                changed
            }
            Some("pending_request.resolved" | "pending_request.expired") => {
                let request_id = event_text(event, "/payload/request/requestId");
                let Some(index) = self.activity_index(project_id, task_id) else {
                    return false;
                };
                let record = &mut self.activities[index];
                let mut removed =
                    request_id.is_some_and(|id| record.pending_request_ids.remove(id));
                removed |= request_id.is_some_and(|id| record.approval_request_ids.remove(id));
                record.refresh_approval_state();
                if record.pending_request_ids.is_empty()
                    && record.snapshot.status == TaskActivityStatus::Waiting
                {
                    record.snapshot.status = TaskActivityStatus::Running;
                    return true;
                }
                removed
            }
            Some("turn.completed") => {
                let failed = event
                    .as_json()
                    .and_then(|event| event.pointer("/payload/turn/status"))
                    .and_then(serde_json::Value::as_str)
                    .is_some_and(|status| matches!(status, "failed" | "interrupted"));
                self.set_terminal_status(project_id, task_id, failed)
            }
            Some("provider.error")
                if event
                    .as_json()
                    .and_then(|event| event.pointer("/payload/willRetry"))
                    .and_then(serde_json::Value::as_bool)
                    == Some(false) =>
            {
                self.set_terminal_status(project_id, task_id, true)
            }
            Some("task.status_updated") => match event
                .as_json()
                .and_then(|event| event.pointer("/payload/status"))
                .and_then(serde_json::Value::as_str)
            {
                Some("running") => {
                    let started_at = event_text(event, "/timestamp").map(str::to_owned);
                    let inserted = self.activity_index(project_id, task_id).is_none();
                    let record = self.ensure_activity(project_id, task_id);
                    let was_active = matches!(
                        record.snapshot.status,
                        TaskActivityStatus::Running | TaskActivityStatus::Waiting
                    );
                    let mut changed =
                        inserted || record.snapshot.status != TaskActivityStatus::Running;
                    record.snapshot.status = TaskActivityStatus::Running;
                    if (inserted || !was_active || record.snapshot.started_at.is_none())
                        && started_at.is_some()
                    {
                        changed |= record.snapshot.started_at != started_at;
                        record.snapshot.started_at = started_at;
                    }
                    changed
                }
                Some("failed") => self.set_terminal_status(project_id, task_id, true),
                _ => false,
            },
            _ => false,
        }
    }

    pub(super) fn apply_event_for_viewed_task(
        &mut self,
        project_id: &str,
        event: &AgentEvent,
        task_is_viewed: bool,
    ) -> bool {
        let changed = self.apply_event(project_id, event);
        if !task_is_viewed || event.event_type() != Some("turn.completed") {
            return changed;
        }
        let acknowledged = event
            .task_id()
            .is_some_and(|task_id| self.acknowledge(project_id, task_id));
        changed || acknowledged
    }

    pub(super) fn remember_project_root(&mut self, project_id: &str, root_path: Option<&str>) {
        let Some(root_path) = normalized(root_path) else {
            return;
        };
        self.project_roots
            .insert(project_id.to_owned(), root_path.to_owned());
        for metadata in self
            .metadata
            .values_mut()
            .filter(|metadata| metadata.project_id == project_id)
        {
            metadata.root_path = Some(root_path.to_owned());
        }
        for record in self
            .activities
            .iter_mut()
            .filter(|record| record.snapshot.project_id == project_id)
        {
            record.snapshot.root_path = Some(root_path.to_owned());
        }
    }

    pub(super) fn forget_project(&mut self, project_id: &str) {
        self.project_roots.remove(project_id);
        self.metadata
            .retain(|_, metadata| metadata.project_id != project_id);
        self.activities
            .retain(|record| record.snapshot.project_id != project_id);
    }

    pub(super) fn remember_task(
        &mut self,
        project_id: &str,
        task_id: &str,
        task_name: &str,
        root_path: Option<&str>,
    ) {
        if !self.metadata.contains_key(task_id) && self.metadata.len() >= MAX_TASK_METADATA {
            self.evict_inactive_metadata();
        }
        let root_path = normalized(root_path)
            .map(str::to_owned)
            .or_else(|| self.project_roots.get(project_id).cloned());
        let task_name = normalized(Some(task_name)).unwrap_or(task_id).to_owned();
        self.metadata.insert(
            task_id.to_owned(),
            TaskMetadata {
                project_id: project_id.to_owned(),
                root_path: root_path.clone(),
                task_name: task_name.clone(),
            },
        );
        if let Some(index) = self.activity_index(project_id, task_id) {
            let snapshot = &mut self.activities[index].snapshot;
            snapshot.root_path = root_path;
            snapshot.task_name = task_name;
        }
    }

    pub(super) fn remember_task_snapshot(
        &mut self,
        project_id: &str,
        task_id: &str,
        task_name: &str,
        status: &str,
        pending_requests: Vec<(String, bool)>,
        started_at: Option<&str>,
    ) {
        self.remember_task(project_id, task_id, task_name, None);
        if !pending_requests.is_empty() {
            let record = self.ensure_activity(project_id, task_id);
            record.snapshot.status = TaskActivityStatus::Waiting;
            record.pending_request_ids = pending_requests
                .iter()
                .map(|(request_id, _)| request_id.clone())
                .collect();
            record.approval_request_ids = pending_requests
                .into_iter()
                .filter_map(|(request_id, approval)| approval.then_some(request_id))
                .collect();
            record.refresh_approval_state();
            if let Some(started_at) = started_at {
                record.snapshot.started_at = Some(started_at.to_owned());
            }
            return;
        }
        match status {
            "running" => {
                let record = self.ensure_activity(project_id, task_id);
                record.snapshot.status = TaskActivityStatus::Running;
                record.clear_pending_requests();
                if let Some(started_at) = started_at {
                    record.snapshot.started_at = Some(started_at.to_owned());
                }
            }
            "failed" => {
                self.set_terminal_status(project_id, task_id, true);
            }
            _ => {
                // 普通空闲任务不创建活动；已有运行记录必须由权威快照收敛为完成。
                if let Some(index) = self.activity_index(project_id, task_id) {
                    let record = &mut self.activities[index];
                    record.snapshot.status = TaskActivityStatus::Completed;
                    record.clear_pending_requests();
                }
            }
        }
    }

    pub(super) fn promote_placeholder_title(
        &mut self,
        project_id: &str,
        task_id: &str,
        task_name: &str,
    ) -> bool {
        let Some(task_name) = normalized(Some(task_name)) else {
            return false;
        };
        // 首轮输入只能替换默认占位标题，不能覆盖用户或 Provider 已设置的标题。
        if self
            .metadata
            .get(task_id)
            .is_some_and(|metadata| metadata.task_name != "新聊天")
        {
            return false;
        }
        let root_path = self
            .metadata
            .get(task_id)
            .and_then(|metadata| metadata.root_path.as_deref())
            .map(str::to_owned);
        self.remember_task(project_id, task_id, task_name, root_path.as_deref());
        true
    }

    pub(super) fn snapshot(&self) -> Vec<TaskActivitySnapshot> {
        self.activities
            .iter()
            .map(|record| record.snapshot.clone())
            .collect()
    }

    pub(super) fn task_name(&self, task_id: &str) -> Option<&str> {
        self.metadata
            .get(task_id)
            .map(|metadata| metadata.task_name.as_str())
    }

    fn activity_index(&self, project_id: &str, task_id: &str) -> Option<usize> {
        self.activities.iter().position(|record| {
            record.snapshot.project_id == project_id && record.snapshot.task_id == task_id
        })
    }

    fn ensure_activity(&mut self, project_id: &str, task_id: &str) -> &mut TaskActivityRecord {
        if let Some(index) = self.activity_index(project_id, task_id) {
            return &mut self.activities[index];
        }
        if self.activities.len() >= MAX_TASK_ACTIVITIES {
            let terminal_index = self
                .activities
                .iter()
                .position(|record| {
                    matches!(
                        record.snapshot.status,
                        TaskActivityStatus::Completed | TaskActivityStatus::Failed
                    )
                })
                .unwrap_or(0);
            self.activities.remove(terminal_index);
        }
        let metadata = self.metadata.get(task_id);
        self.activities.push(TaskActivityRecord {
            approval_request_ids: HashSet::new(),
            pending_request_ids: HashSet::new(),
            snapshot: TaskActivitySnapshot {
                project_id: project_id.to_owned(),
                requires_approval: false,
                root_path: metadata.and_then(|metadata| metadata.root_path.clone()),
                started_at: None,
                status: TaskActivityStatus::Running,
                task_id: task_id.to_owned(),
                task_name: metadata
                    .map(|metadata| metadata.task_name.clone())
                    .unwrap_or_else(|| task_id.to_owned()),
            },
        });
        self.activities
            .last_mut()
            .expect("activity was just inserted")
    }

    fn evict_inactive_metadata(&mut self) {
        let active_ids = self
            .activities
            .iter()
            .map(|record| record.snapshot.task_id.as_str())
            .collect::<HashSet<_>>();
        let candidate = self
            .metadata
            .keys()
            .find(|task_id| !active_ids.contains(task_id.as_str()))
            .cloned();
        if let Some(task_id) = candidate {
            self.metadata.remove(&task_id);
        }
    }

    fn remove_task(&mut self, project_id: &str, task_id: &str) -> bool {
        let metadata_removed = self
            .metadata
            .remove(task_id)
            .is_some_and(|metadata| metadata.project_id == project_id);
        let original_len = self.activities.len();
        self.activities.retain(|record| {
            record.snapshot.project_id != project_id || record.snapshot.task_id != task_id
        });
        metadata_removed || self.activities.len() != original_len
    }

    fn set_terminal_status(&mut self, project_id: &str, task_id: &str, failed: bool) -> bool {
        let status = if failed {
            TaskActivityStatus::Failed
        } else {
            TaskActivityStatus::Completed
        };
        let record = self.ensure_activity(project_id, task_id);
        let changed = record.snapshot.status != status || !record.pending_request_ids.is_empty();
        record.snapshot.status = status;
        record.clear_pending_requests();
        changed
    }

    fn update_title(&mut self, project_id: &str, task_id: &str, task_name: Option<&str>) -> bool {
        let Some(task_name) = normalized(task_name) else {
            return false;
        };
        let root_path = self
            .metadata
            .get(task_id)
            .and_then(|metadata| metadata.root_path.as_deref())
            .map(str::to_owned);
        self.remember_task(project_id, task_id, task_name, root_path.as_deref());
        true
    }
}

fn normalized(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|value| !value.is_empty())
}

pub(super) fn is_approval_request_type(request_type: &str) -> bool {
    matches!(
        request_type,
        "command_approval"
            | "terminal_input_approval"
            | "file_change_approval"
            | "permissions_approval"
            | "mcp_elicitation"
            | "plugin_install_suggestion"
    )
}

fn event_text<'a>(event: &'a AgentEvent, pointer: &str) -> Option<&'a str> {
    event
        .as_json()
        .and_then(|event| event.pointer(pointer))
        .and_then(serde_json::Value::as_str)
}
