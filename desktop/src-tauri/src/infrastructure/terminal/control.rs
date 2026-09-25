use super::manager::{Registry, TerminalManager};
use crate::domain::project_terminal::{TerminalControlEvent, TerminalError, TerminalSnapshot};
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
use tauri::ipc::Channel;
use tokio::sync::mpsc;

pub(super) struct ControlSender {
    sender: mpsc::Sender<TerminalControlEvent>,
    fail: Arc<dyn Fn() + Send + Sync>,
}

impl ControlSender {
    pub fn send(&self, event: TerminalControlEvent) -> Result<(), TerminalError> {
        self.sender.try_send(event).map_err(|_| {
            (self.fail)();
            TerminalError::StreamInvalid
        })
    }
}

impl TerminalManager {
    pub fn reconnect(
        &self,
        channel: Channel<TerminalControlEvent>,
    ) -> Result<TerminalSnapshot, TerminalError> {
        let generation = {
            let mut registry = self.lock();
            if registry.transitioning {
                return Err(TerminalError::OwnerClosing);
            }
            registry.transitioning = true;
            registry.generation.clone()
        };
        if let Err(error) = self.close_generation(&generation) {
            self.lock().transitioning = false;
            return Err(error);
        }
        let old = {
            let mut registry = self.lock();
            std::mem::replace(&mut *registry, Registry::transitioning())
        };
        // 旧 generation 的队列在锁外销毁；晚到的失败回调只能清理旧 generation。
        drop(old);
        let result = self.subscribe(channel);
        self.lock().transitioning = false;
        result
    }

    pub fn subscribe(
        &self,
        channel: Channel<TerminalControlEvent>,
    ) -> Result<TerminalSnapshot, TerminalError> {
        let mut registry = self.lock();
        if registry.control.is_some() {
            return Err(TerminalError::RequestConflict);
        }
        let weak = Arc::downgrade(&self.registry);
        let generation = registry.generation.clone();
        let failed = AtomicBool::new(false);
        let fail: Arc<dyn Fn() + Send + Sync> = Arc::new(move || {
            if failed.swap(true, Ordering::AcqRel) {
                return;
            }
            let weak = weak.clone();
            let generation = generation.clone();
            // 失败回收在独立 blocking 工作中执行，不能反向等待发布者持有的注册表锁。
            tauri::async_runtime::spawn_blocking(move || {
                if let Some(registry) = weak.upgrade() {
                    let manager = TerminalManager { registry };
                    let _ = manager.close_generation(&generation);
                }
            });
        });
        let (sender, mut receiver) = mpsc::channel(128);
        registry.control = Some(ControlSender {
            sender,
            fail: fail.clone(),
        });
        let snapshot = registry.snapshot();
        tauri::async_runtime::spawn(async move {
            while let Some(event) = receiver.recv().await {
                if channel.send(event).is_err() {
                    fail();
                    break;
                }
            }
        });
        Ok(snapshot)
    }

    pub fn close_generation(&self, generation: &str) -> Result<(), TerminalError> {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
        let scopes = {
            let mut registry = self.lock();
            if registry.generation != generation {
                return Ok(());
            }
            registry.closing = true;
            registry
                .entries
                .values()
                .filter_map(|entry| {
                    entry.cancelled.store(true, Ordering::Release);
                    entry
                        .metadata
                        .as_ref()
                        .filter(|metadata| metadata.state.is_live())
                        .map(|metadata| metadata.scope.clone())
                })
                .collect::<Vec<_>>()
        };
        std::thread::scope(|workers| {
            let jobs: Vec<_> = scopes
                .iter()
                .map(|scope| workers.spawn(|| self.close(scope)))
                .collect();
            let mut result = Ok(());
            for job in jobs {
                if job
                    .join()
                    .unwrap_or(Err(TerminalError::CleanupFailed))
                    .is_err()
                {
                    result = Err(TerminalError::CleanupFailed);
                }
            }
            result
        })?;
        let registry = self.lock();
        let wake = registry.pending_changed.clone();
        let (registry, _) = wake
            .wait_timeout_while(
                registry,
                deadline.saturating_duration_since(std::time::Instant::now()),
                |registry| {
                    registry.generation == generation
                        && registry
                            .entries
                            .values()
                            .any(|entry| entry.metadata.is_none())
                },
            )
            .map_err(|_| TerminalError::CleanupFailed)?;
        if registry.generation == generation && registry.quotas.total() != 0 {
            return Err(TerminalError::CleanupFailed);
        }
        Ok(())
    }
}
