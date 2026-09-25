use super::AppState;
use crate::application::task_activity::{
    TaskActivitySnapshot, TaskActivityState, is_approval_request_type,
};
use crate::domain::conversation::AgentTaskSnapshot;
use crate::domain::sidebar::{Project, ProjectPage};

impl AppState {
    pub async fn acknowledge_task_activity(&self, project_id: &str, task_id: &str) -> bool {
        self.runtime
            .lock()
            .await
            .task_activity
            .acknowledge(project_id, task_id)
    }

    pub async fn remember_project_page(&self, page: &ProjectPage) {
        let mut runtime = self.runtime.lock().await;
        for project in &page.data {
            remember_project_root(&mut runtime.task_activity, project);
        }
    }

    pub async fn remember_project(&self, project: &Project) {
        remember_project_root(&mut self.runtime.lock().await.task_activity, project);
    }

    pub async fn forget_project_activity(&self, project_id: &str) {
        let mut runtime = self.runtime.lock().await;
        runtime.task_snapshot_metadata.forget_project(project_id);
        runtime.task_failure_projection.forget_project(project_id);
        runtime.task_skill_projection.forget_project(project_id);
        runtime.task_activity.forget_project(project_id);
    }

    pub async fn remember_task_metadata<'a>(
        &self,
        project_id: &str,
        tasks: impl IntoIterator<Item = (&'a str, &'a str)>,
    ) {
        let mut runtime = self.runtime.lock().await;
        runtime
            .project_sequences
            .entry(project_id.to_owned())
            .or_default();
        for (task_id, title) in tasks {
            runtime
                .task_projects
                .insert(task_id.to_owned(), project_id.to_owned());
            runtime
                .task_activity
                .remember_task(project_id, task_id, title, None);
        }
    }

    pub(crate) async fn task_activity_snapshot(&self) -> Vec<TaskActivitySnapshot> {
        self.runtime.lock().await.task_activity.snapshot()
    }

    pub async fn remember_task_snapshot(&self, snapshot: &AgentTaskSnapshot) {
        let mut runtime = self.runtime.lock().await;
        runtime
            .task_projects
            .insert(snapshot.id.clone(), snapshot.project_id.clone());
        runtime.task_activity.remember_task_snapshot(
            &snapshot.project_id,
            &snapshot.id,
            &snapshot.title,
            snapshot.status,
            snapshot
                .pending_requests
                .iter()
                .filter_map(|request| {
                    let request_id = request.get("requestId")?.as_str()?.to_owned();
                    let requires_approval = request
                        .get("type")
                        .and_then(serde_json::Value::as_str)
                        .is_some_and(is_approval_request_type);
                    Some((request_id, requires_approval))
                })
                .collect(),
            snapshot
                .turns
                .iter()
                .rev()
                .find(|turn| turn.status == "running")
                .and_then(|turn| turn.started_at.as_deref()),
        );
    }

    pub async fn promote_task_title(
        &self,
        project_id: &str,
        task_id: &str,
        task_name: &str,
    ) -> bool {
        let mut runtime = self.runtime.lock().await;
        runtime
            .task_projects
            .insert(task_id.to_owned(), project_id.to_owned());
        runtime
            .task_activity
            .promote_placeholder_title(project_id, task_id, task_name)
    }
}

fn remember_project_root(state: &mut TaskActivityState, project: &Project) {
    state.remember_project_root(
        &project.id,
        project.roots.first().map(|root| root.path.as_str()),
    );
}
