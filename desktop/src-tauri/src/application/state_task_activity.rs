use super::AppState;
use crate::application::task_activity::{
    TaskActivitySnapshot, TaskActivityState, TaskActivityStatus,
};
use crate::domain::sidebar::{Project, ProjectPage};

impl AppState {
    pub async fn resolve_async_question_activity(
        &self,
        project_id: &str,
        task_id: &str,
        question_id: &str,
    ) -> bool {
        self.runtime
            .lock()
            .await
            .task_activity
            .resolve_async_question(project_id, task_id, question_id)
    }

    pub async fn acknowledge_task_activity(&self, project_id: &str, task_id: &str) -> bool {
        self.runtime
            .lock()
            .await
            .task_activity
            .acknowledge(project_id, task_id)
    }

    pub(in crate::application) async fn acknowledge_task_activity_at(
        &self,
        project_id: &str,
        task_id: &str,
        sequence: Option<u64>,
    ) -> bool {
        self.runtime
            .lock()
            .await
            .task_activity
            .acknowledge_at(project_id, task_id, sequence)
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

    pub(crate) async fn task_activity_read_snapshot(&self) -> Vec<serde_json::Value> {
        let runtime = self.runtime.lock().await;
        runtime.task_activity.snapshot().into_iter().map(|snapshot| {
            let terminal_sequence = match snapshot.status {
                TaskActivityStatus::Completed | TaskActivityStatus::Failed => snapshot.terminal_sequence,
                _ => None,
            };
            let sequence = terminal_sequence.unwrap_or_else(|| {
                runtime.project_sequences.get(&snapshot.project_id).copied().unwrap_or_default()
            });
            let mut value = serde_json::json!(&snapshot);
            value["checkpoint"] = serde_json::json!({ "sequence": sequence, "sessionId": crate::application::state::runtime_session_id() });
            value
        }).collect()
    }

    pub(crate) async fn task_activity_snapshot(&self) -> Vec<TaskActivitySnapshot> {
        self.runtime.lock().await.task_activity.snapshot()
    }
}

fn remember_project_root(state: &mut TaskActivityState, project: &Project) {
    state.remember_project_root(
        &project.id,
        project.roots.first().map(|root| root.path.as_str()),
    );
}
