use crate::domain::project_terminal::TerminalError;
use portable_pty::Child;
use std::{
    sync::{Arc, Condvar, Mutex},
    thread::JoinHandle,
    time::Duration,
};
use tokio::sync::watch;

type ExitResult = Result<u32, TerminalError>;
pub(super) struct ChildExit {
    #[cfg(any(unix, feature = "webview-tests"))]
    pub pid: u32,
    completion: Arc<(Mutex<Option<ExitResult>>, Condvar)>,
    receiver: watch::Receiver<Option<ExitResult>>,
    worker: Mutex<Option<JoinHandle<()>>>,
}

impl ChildExit {
    pub fn start(mut child: Box<dyn Child + Send + Sync>) -> Result<Self, TerminalError> {
        #[cfg(any(unix, feature = "webview-tests"))]
        let pid = child.process_id().ok_or(TerminalError::SpawnFailed)?;
        let killer = child.clone_killer();
        let completion = Arc::new((Mutex::new(None), Condvar::new()));
        let done = completion.clone();
        let (sender, receiver) = watch::channel(None);
        let worker = std::thread::Builder::new()
            .name("terminal-child".into())
            .spawn(move || {
                let result = child
                    .wait()
                    .map(|status| status.exit_code())
                    .map_err(|_| TerminalError::CleanupFailed);
                let (state, wake) = &*done;
                *state
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(result);
                sender.send_replace(Some(result));
                wake.notify_all();
            })
            .map_err(|_| {
                let mut cleanup = killer.clone_killer();
                let _ = cleanup.kill();
                TerminalError::SpawnFailed
            })?;
        Ok(Self {
            #[cfg(any(unix, feature = "webview-tests"))]
            pid,
            completion,
            receiver,
            worker: Mutex::new(Some(worker)),
        })
    }

    pub async fn wait(&self) -> ExitResult {
        let mut receiver = self.receiver.clone();
        loop {
            if let Some(result) = *receiver.borrow_and_update() {
                return result;
            }
            receiver
                .changed()
                .await
                .map_err(|_| TerminalError::CleanupFailed)?;
        }
    }

    pub fn wait_timeout(&self, duration: Duration) -> Result<bool, TerminalError> {
        let (state, wake) = &*self.completion;
        let state = state.lock().map_err(|_| TerminalError::CleanupFailed)?;
        let (state, _) = wake
            .wait_timeout_while(state, duration, |state| state.is_none())
            .map_err(|_| TerminalError::CleanupFailed)?;
        Ok(state.is_some())
    }

    pub fn join(&self) -> Result<(), TerminalError> {
        if let Some(worker) = self
            .worker
            .lock()
            .map_err(|_| TerminalError::CleanupFailed)?
            .take()
        {
            worker.join().map_err(|_| TerminalError::CleanupFailed)?;
        }
        self.receiver
            .borrow()
            .as_ref()
            .copied()
            .ok_or(TerminalError::CleanupFailed)?
            .map(|_| ())
    }

    pub fn exit_code(&self) -> Option<u32> {
        self.receiver
            .borrow()
            .as_ref()
            .and_then(|result| result.as_ref().ok())
            .copied()
    }
}
