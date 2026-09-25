use super::{
    AppError, AppServerConnection, AppState, Arc, CodexProcess, PendingServerRequest,
    RuntimeSession,
};
use crate::application::pending_resolution::PendingResolutionReference;

impl AppState {
    pub(crate) async fn claim_pending_resolution(
        &self,
        reference: &PendingResolutionReference,
    ) -> Result<(Arc<AppServerConnection>, PendingServerRequest), AppError> {
        let mut runtime = self.runtime.lock().await;
        let connection = runtime
            .codex_process
            .as_ref()
            .map(CodexProcess::connection)
            .ok_or(AppError::CodexRuntimeUnavailable)?;
        if !runtime
            .pending_requests
            .get(&reference.request_id)
            .is_some_and(|pending| reference.matches(&pending.request))
        {
            return Err(AppError::PendingRequestUnavailable);
        }
        let pending = runtime
            .pending_requests
            .remove(&reference.request_id)
            .ok_or(AppError::PendingRequestUnavailable)?;
        Ok((connection, pending))
    }

    pub(crate) async fn restore_pending_resolution(
        &self,
        connection: &Arc<AppServerConnection>,
        pending: PendingServerRequest,
    ) {
        let mut runtime = self.runtime.lock().await;
        // 旧连接的迟到失败不能复活过期审批，也不能覆盖新请求复用的 RPC ID。
        if !runtime.owns_connection(connection) {
            return;
        }
        let Some(id) = pending.request["requestId"].as_str() else {
            return;
        };
        if !runtime.pending_requests.contains_key(id) {
            runtime.pending_requests.insert(id.to_owned(), pending);
        }
    }
}

impl RuntimeSession {
    pub(super) fn owns_connection(&self, connection: &Arc<AppServerConnection>) -> bool {
        self.codex_process
            .as_ref()
            .is_some_and(|process| Arc::ptr_eq(&process.connection(), connection))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::codex::{ServerMessage, map_server_request_now};
    use serde_json::{json, value::to_raw_value};

    #[test]
    fn pending_resolution_budget_should_not_be_starved_by_prompt_submission() {
        let state = AppState::default();
        let _full = state.submission_budget.reserve(8 * 1024 * 1024).unwrap();
        assert!(state.pending_resolution_budget.reserve(1024).is_ok());
    }

    #[tokio::test]
    async fn pending_resolution_should_not_restore_or_publish_for_an_old_connection() {
        let state = AppState::default();
        let (client, _server) = tokio::io::duplex(4096);
        let (reader, writer) = tokio::io::split(client);
        let connection = Arc::new(AppServerConnection::new(reader, writer));
        let mut pending = map_server_request_now(ServerMessage {
            id: Some(9), method: "item/tool/requestUserInput".into(),
            params: to_raw_value(&json!({
                "threadId":"task", "turnId":"turn", "itemId":"item",
                "questions":[{"id":"q", "header":"Question", "question":"Continue?", "isOther":false, "isSecret":false, "options":null}]
            })).unwrap(),
        }, 0).unwrap().unwrap().pending;
        pending.request["projectId"] = json!("project");
        assert!(matches!(
            state
                .publish_pending_resolution(&connection, &pending)
                .await,
            Err(AppError::PendingRequestUnavailable)
        ));
        state.restore_pending_resolution(&connection, pending).await;
        let runtime = state.runtime.lock().await;
        assert!(runtime.pending_requests.is_empty());
        assert!(runtime.project_sequences.is_empty());
    }
}
