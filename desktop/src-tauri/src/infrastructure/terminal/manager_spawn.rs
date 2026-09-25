use super::{
    manager::{Reservation, TerminalManager},
    session::Session,
    shell::command_for_root,
    transport::Transport,
};
use crate::domain::project_terminal::{TerminalError, TerminalMetadata, TerminalScope};
use std::{
    path::Path,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};
use tauri::ipc::{Channel, Response};

impl Reservation {
    pub fn spawn_root(
        self,
        root: &Path,
        output: Channel<Response>,
    ) -> Result<TerminalMetadata, TerminalError> {
        self.validate()?;
        let command = command_for_root(root)?;
        let title = command
            .get_argv()
            .first()
            .and_then(|path| Path::new(path).file_name())
            .map_or_else(
                || "shell".to_owned(),
                |name| name.to_string_lossy().into_owned(),
            );
        let session = Arc::new(Session::spawn(
            command,
            self.request.cols,
            self.request.rows,
        )?);
        let scope = TerminalScope {
            project_id: self.request.project_id.clone(),
            terminal_id: self.terminal_id.clone(),
            generation: self.request.generation.clone(),
        };
        let failed = Arc::new(AtomicBool::new(false));
        let failure_flag = failed.clone();
        let weak = Arc::downgrade(&self.manager.registry);
        let failure_scope = scope.clone();
        let failure = Arc::new(move || {
            failure_flag.store(true, Ordering::Release);
            let weak = weak.clone();
            let scope = failure_scope.clone();
            tauri::async_runtime::spawn_blocking(move || {
                if let Some(registry) = weak.upgrade() {
                    let _ = TerminalManager { registry }.fail(&scope);
                }
            });
        });
        let transport = match Transport::start(session.clone(), output, failure) {
            Ok(transport) => transport,
            Err(error) => {
                if session.close().is_err() {
                    return Err(self.retain_for_cleanup(session, title, None));
                }
                return Err(error);
            }
        };
        let manager = self.manager.clone();
        let metadata = self.commit_with_transport(session, title, Some(transport))?;
        // 启动输出可能早于 commit 失败；二次检查覆盖回调尚未找到完整元数据的窗口。
        if failed.load(Ordering::Acquire) {
            manager.fail(&scope)?;
            return Err(TerminalError::StreamInvalid);
        }
        Ok(metadata)
    }
}
