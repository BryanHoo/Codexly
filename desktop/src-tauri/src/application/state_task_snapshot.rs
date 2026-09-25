use super::AppState;
use crate::domain::conversation::AgentTaskSnapshotResponse;

impl AppState {
    pub(crate) async fn task_snapshot_baseline(&self, project: &str) -> (u64, u64, u64) {
        let runtime = self.runtime.lock().await;
        (
            runtime
                .project_sequences
                .get(project)
                .copied()
                .unwrap_or_default(),
            runtime.event_generation,
            runtime.restart_generation,
        )
    }

    #[cfg(test)]
    pub(crate) async fn complete_task_snapshot(&self, response: &mut AgentTaskSnapshotResponse) {
        self.complete_task_snapshot_at(response, None).await;
    }

    pub(crate) async fn complete_task_snapshot_at(
        &self,
        response: &mut AgentTaskSnapshotResponse,
        baseline: Option<(u64, u64, u64)>,
    ) {
        let seed = baseline
            .and_then(|_| response.snapshot.turns.last())
            .filter(|turn| turn.status == "running")
            .and_then(|turn| turn.items.last())
            .and_then(super::task_skill_message::SkillMessage::from_item);
        let mut runtime = self.runtime.lock().await;
        let snapshot = &mut response.snapshot;
        // 原生元数据、审批注册和 checkpoint 在同一临界区读取；窗口重建无需旧 Store。
        runtime.task_snapshot_metadata.apply(snapshot);
        runtime.task_failure_projection.apply(snapshot);
        runtime.task_skill_projection.apply(snapshot);
        // 只给没有实时记录的任务补种。历史读取期间发生事件或换代时，禁止用迟到快照建立关联。
        if baseline
            == Some((
                runtime
                    .project_sequences
                    .get(&snapshot.project_id)
                    .copied()
                    .unwrap_or_default(),
                runtime.event_generation,
                runtime.restart_generation,
            ))
        {
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
    }
}
