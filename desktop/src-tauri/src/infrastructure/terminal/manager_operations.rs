use super::manager::TerminalManager;
use crate::domain::project_terminal::{
    DecimalU64, TerminalError, TerminalEvent, TerminalScope, TerminalSnapshot, TerminalState,
};

impl TerminalManager {
    pub fn close_project(&self, project_id: &str) -> Result<(), TerminalError> {
        self.invalidate_project(project_id);
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
        let scopes: Vec<_> = self
            .snapshot()
            .terminals
            .into_iter()
            .filter(|metadata| metadata.scope.project_id == project_id)
            .map(|metadata| metadata.scope)
            .collect();
        std::thread::scope(|workers| {
            let jobs: Vec<_> = scopes
                .iter()
                .map(|scope| workers.spawn(|| self.close(scope)))
                .collect();
            let mut failed = false;
            for job in jobs {
                failed |= !matches!(job.join(), Ok(Ok(())) | Ok(Err(TerminalError::NotFound)));
            }
            if failed {
                Err(TerminalError::CleanupFailed)
            } else {
                Ok(())
            }
        })?;
        let registry = self.lock();
        let wake = registry.pending_changed.clone();
        let (registry, _) = wake
            .wait_timeout_while(
                registry,
                deadline.saturating_duration_since(std::time::Instant::now()),
                |registry| {
                    registry
                        .entries
                        .values()
                        .any(|entry| entry.project_id == project_id && entry.metadata.is_none())
                },
            )
            .map_err(|_| TerminalError::CleanupFailed)?;
        if registry.entries.values().any(|entry| {
            entry.project_id == project_id
                && entry
                    .metadata
                    .as_ref()
                    .is_none_or(|metadata| metadata.state.is_live())
        }) {
            return Err(TerminalError::CleanupFailed);
        }
        drop(registry);
        for scope in self
            .snapshot()
            .terminals
            .into_iter()
            .filter(|metadata| metadata.scope.project_id == project_id)
            .map(|metadata| metadata.scope)
        {
            match self.remove(&scope) {
                Ok(()) | Err(TerminalError::NotFound) => {}
                Err(error) => return Err(error),
            }
        }
        Ok(())
    }

    pub fn snapshot(&self) -> TerminalSnapshot {
        self.lock().snapshot()
    }

    pub fn close(&self, scope: &TerminalScope) -> Result<(), TerminalError> {
        self.finish(scope, false)
    }

    pub(super) fn fail(&self, scope: &TerminalScope) -> Result<(), TerminalError> {
        {
            let mut registry = self.lock();
            if registry.generation != scope.generation {
                return Err(TerminalError::ScopeMismatch);
            }
            let entry = registry
                .entries
                .get_mut(&scope.terminal_id)
                .ok_or(TerminalError::NotFound)?;
            if entry.project_id != scope.project_id {
                return Err(TerminalError::ScopeMismatch);
            }
            entry.failed = true;
        }
        self.finish(scope, false)
    }

    pub(super) fn finish(&self, scope: &TerminalScope, natural: bool) -> Result<(), TerminalError> {
        let (session, transport) = {
            let mut registry = self.lock();
            if registry.generation != scope.generation {
                return Err(TerminalError::ScopeMismatch);
            }
            let entry = registry
                .entries
                .get_mut(&scope.terminal_id)
                .ok_or(TerminalError::NotFound)?;
            if entry.project_id != scope.project_id {
                return Err(TerminalError::ScopeMismatch);
            }
            let metadata = entry.metadata.as_mut().ok_or(TerminalError::NotFound)?;
            if !metadata.state.is_live() {
                return Ok(());
            }
            let changed = metadata.state != TerminalState::Closing;
            metadata.state = TerminalState::Closing;
            let event = TerminalEvent::StateChanged(metadata.clone());
            let handles = (
                entry.session.clone().ok_or(TerminalError::NotFound)?,
                entry.transport.clone(),
            );
            if changed {
                registry.publish(event);
            }
            handles
        };
        // 进程与线程回收不能持有全局锁；失败时保持 closing 和配额，允许显式重试。
        let truncated_reason = if natural {
            transport
                .as_ref()
                .filter(|transport| !transport.wait_reader(std::time::Duration::from_millis(200)))
                .map(|_| "drain_timeout".to_owned())
        } else {
            Some("terminated".to_owned())
        };
        if let Some(transport) = &transport {
            transport.cancel();
        }
        session.close()?;
        if let Some(transport) = &transport {
            transport.join(std::time::Duration::from_millis(200))?;
        }
        let mut registry = self.lock();
        let Some(entry) = registry.entries.get_mut(&scope.terminal_id) else {
            return Ok(());
        };
        let Some(metadata) = entry.metadata.as_mut() else {
            return Err(TerminalError::NotFound);
        };
        if metadata.state.is_live() {
            metadata.state = if entry.failed {
                TerminalState::Failed
            } else {
                TerminalState::Exited
            };
            metadata.exit_code = session.exit_code();
            entry.final_offset = transport
                .as_ref()
                .map_or(0, |transport| transport.final_offset());
            let event = TerminalEvent::Exited {
                metadata: metadata.clone(),
                final_offset: DecimalU64(
                    transport
                        .as_ref()
                        .map_or(0, |transport| transport.final_offset()),
                ),
                truncated_reason: if entry.failed {
                    Some("stream_failed".to_owned())
                } else {
                    truncated_reason
                },
            };
            entry.session = None;
            entry.transport = None;
            registry.quotas.release(&scope.project_id);
            registry.publish(event);
            registry.exited.push_back(scope.terminal_id.clone());
            // 退出顺序独立于 HashMap 迭代顺序，淘汰不会触碰存活会话。
            while registry
                .exited
                .iter()
                .filter(|id| {
                    registry
                        .entries
                        .get(*id)
                        .is_some_and(|entry| entry.project_id == scope.project_id)
                })
                .count()
                > 4
            {
                let oldest = registry.exited.iter().position(|id| {
                    registry
                        .entries
                        .get(id)
                        .is_some_and(|entry| entry.project_id == scope.project_id)
                });
                if let Some(id) = oldest.and_then(|index| registry.exited.remove(index))
                    && let Some(entry) = registry.entries.remove(&id)
                {
                    registry.publish(TerminalEvent::Removed(entry.metadata.unwrap().scope));
                }
            }
            while registry.exited.len() > 12 {
                if let Some(id) = registry.exited.pop_front()
                    && let Some(entry) = registry.entries.remove(&id)
                {
                    registry.publish(TerminalEvent::Removed(entry.metadata.unwrap().scope));
                }
            }
        }
        Ok(())
    }

    pub fn remove(&self, scope: &TerminalScope) -> Result<(), TerminalError> {
        let mut registry = self.lock();
        if registry.generation != scope.generation {
            return Err(TerminalError::ScopeMismatch);
        }
        let entry = registry
            .entries
            .get(&scope.terminal_id)
            .ok_or(TerminalError::NotFound)?;
        if entry.project_id != scope.project_id {
            return Err(TerminalError::ScopeMismatch);
        }
        if entry
            .metadata
            .as_ref()
            .is_none_or(|metadata| metadata.state.is_live())
        {
            return Err(TerminalError::RequestConflict);
        }
        registry.entries.remove(&scope.terminal_id);
        registry.exited.retain(|id| id != &scope.terminal_id);
        registry.publish(TerminalEvent::Removed(scope.clone()));
        Ok(())
    }
}
