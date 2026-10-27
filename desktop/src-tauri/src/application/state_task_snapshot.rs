use super::{AppError, AppState};
use crate::domain::conversation::AgentTaskSnapshotResponse;
use std::{
    future::Future,
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
};

pub(crate) struct TaskSnapshotBaseline {
    project_sequence: u64,
    event_generation: u64,
    restart_generation: u64,
    revision: Arc<AtomicU64>,
    version: u64,
}

impl AppState {
    pub(crate) async fn task_snapshot_baseline(
        &self,
        project: &str,
        task: &str,
    ) -> Result<TaskSnapshotBaseline, AppError> {
        let mut runtime = self.runtime.lock().await;
        let revision = runtime
            .task_snapshot_metadata
            .watch_read(task)
            .ok_or(AppError::TaskSnapshotBusy)?;
        Ok(TaskSnapshotBaseline {
            project_sequence: runtime
                .project_sequences
                .get(project)
                .copied()
                .unwrap_or_default(),
            event_generation: runtime.event_generation,
            restart_generation: runtime.restart_generation,
            version: revision.load(Ordering::Relaxed),
            revision,
        })
    }

    pub(crate) async fn read_consistent_task_snapshot<F, Fut>(
        &self,
        project: &str,
        task: &str,
        mut read: F,
    ) -> Result<AgentTaskSnapshotResponse, AppError>
    where
        F: FnMut() -> Fut,
        Fut: Future<Output = Result<AgentTaskSnapshotResponse, AppError>>,
    {
        for attempt in 0..2 {
            let baseline = self.task_snapshot_baseline(project, task).await?;
            let mut response = read().await?;
            match self
                .complete_task_snapshot_at(&mut response, Some(baseline))
                .await
            {
                Ok(()) => return Ok(response),
                // 与 Web 一致，冲突最多重读一次；持续输出时明确失败，不能发布带错误 checkpoint 的正文。
                Err(AppError::TaskSnapshotBusy) if attempt == 0 => continue,
                Err(error) => return Err(error),
            }
        }
        Err(AppError::TaskSnapshotBusy)
    }

    #[cfg(test)]
    pub(crate) async fn complete_task_snapshot(&self, response: &mut AgentTaskSnapshotResponse) {
        self.complete_task_snapshot_at(response, None)
            .await
            .unwrap();
    }

    pub(crate) async fn complete_task_snapshot_at(
        &self,
        response: &mut AgentTaskSnapshotResponse,
        baseline: Option<TaskSnapshotBaseline>,
    ) -> Result<(), AppError> {
        let seed = baseline
            .as_ref()
            .and_then(|_| response.snapshot.turns.last())
            .filter(|turn| turn.status == "running")
            .and_then(|turn| turn.items.last())
            .and_then(super::task_skill_message::SkillMessage::from_item);
        let mut runtime = self.runtime.lock().await;
        if baseline.as_ref().is_some_and(|before| {
            before.version != before.revision.load(Ordering::Relaxed)
                || before.event_generation != runtime.event_generation
                || before.restart_generation != runtime.restart_generation
        }) {
            // 必须在修改快照及捕获 checkpoint 的同一临界区拒绝冲突，防止旧正文吞掉完成事件。
            return Err(AppError::TaskSnapshotBusy);
        }
        let snapshot = &mut response.snapshot;
        // 原生元数据、审批注册和 checkpoint 在同一临界区读取；窗口重建无需旧 Store。
        runtime.task_snapshot_metadata.apply(snapshot);
        runtime.task_failure_projection.apply(snapshot);
        runtime.task_skill_projection.apply(snapshot);
        // 只给没有实时记录的任务补种。历史读取期间发生事件或换代时，禁止用迟到快照建立关联。
        if baseline.as_ref().is_some_and(|before| {
            before.project_sequence
                == runtime
                    .project_sequences
                    .get(&snapshot.project_id)
                    .copied()
                    .unwrap_or_default()
        }) {
            runtime.task_skill_projection.seed(snapshot, seed);
        }
        snapshot.pending_requests = runtime
            .pending_requests
            .values()
            .filter(|pending| {
                pending.request["taskId"].as_str() == Some(snapshot.id.as_str())
                    && pending.request["projectId"].as_str() == Some(snapshot.project_id.as_str())
                    && pending.request["status"].as_str() == Some("pending")
            })
            .map(|pending| pending.request.clone())
            .collect();
        // HashMap 顺序不稳定，恢复后的审批卡片保持确定顺序。
        snapshot.pending_requests.sort_by(|left, right| {
            (left["createdAt"].as_str(), left["requestId"].as_str())
                .cmp(&(right["createdAt"].as_str(), right["requestId"].as_str()))
        });
        response.checkpoint.sequence = runtime
            .project_sequences
            .get(&snapshot.project_id)
            .copied()
            .unwrap_or_default();
        Ok(())
    }
}
