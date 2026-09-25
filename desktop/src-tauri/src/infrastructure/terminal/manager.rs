use super::transport::Transport;
use super::{quota::Quotas, session::Session};
use crate::domain::project_terminal::{
    CreateTerminalRequest, TerminalError, TerminalMetadata, TerminalScope, TerminalState,
    validate_id, validate_size,
};
use crate::domain::project_terminal::{
    DecimalU64, TerminalControlEvent, TerminalEvent, TerminalSnapshot,
};
use std::{
    collections::{HashMap, HashSet, VecDeque},
    sync::{
        Arc, Condvar, Mutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
};

static NEXT_GENERATION: AtomicU64 = AtomicU64::new(1);

#[derive(Clone)]
pub struct TerminalManager {
    pub(super) registry: Arc<Mutex<Registry>>,
}

pub(super) struct Entry {
    pub metadata: Option<TerminalMetadata>,
    pub session: Option<Arc<Session>>,
    pub transport: Option<Arc<Transport>>,
    pub project_id: String,
    pub cancelled: Arc<AtomicBool>,
    pub final_offset: u64,
    pub failed: bool,
    pub resize_lock: Arc<Mutex<()>>,
}

pub(super) struct Registry {
    pub generation: String,
    pub closing: bool,
    pub entries: HashMap<String, Entry>,
    requests: HashMap<String, (u32, String, CreateTerminalRequest)>,
    pub(super) quotas: Quotas,
    next_id: u64,
    deleted_projects: HashSet<String>,
    pub(super) exited: VecDeque<String>,
    pub(super) sequence: u64,
    pub(super) control: Option<super::control::ControlSender>,
    pub(super) transitioning: bool,
    pub(super) pending_changed: Arc<Condvar>,
}

impl Default for TerminalManager {
    fn default() -> Self {
        Self {
            registry: Arc::new(Mutex::new(Registry::default())),
        }
    }
}

impl Default for Registry {
    fn default() -> Self {
        Self {
            generation: NEXT_GENERATION.fetch_add(1, Ordering::Relaxed).to_string(),
            closing: false,
            entries: HashMap::new(),
            requests: HashMap::new(),
            quotas: Quotas::default(),
            next_id: 0,
            deleted_projects: HashSet::new(),
            exited: VecDeque::new(),
            sequence: 0,
            control: None,
            transitioning: false,
            pending_changed: Arc::new(Condvar::new()),
        }
    }
}

impl TerminalManager {
    pub fn cached_creation(
        &self,
        request: &CreateTerminalRequest,
        channel_id: u32,
    ) -> Result<Option<TerminalMetadata>, TerminalError> {
        let registry = self.lock();
        if registry.generation != request.generation {
            return Err(TerminalError::ScopeMismatch);
        }
        if registry.closing {
            return Err(TerminalError::OwnerClosing);
        }
        let Some((original_channel, terminal_id, original)) =
            registry.requests.get(&request.request_id)
        else {
            return Ok(None);
        };
        if *original_channel != channel_id || original != request {
            return Err(TerminalError::RequestConflict);
        }
        let entry = registry
            .entries
            .get(terminal_id)
            .ok_or(TerminalError::NotFound)?;
        if entry.cancelled.load(Ordering::Acquire) {
            return Err(TerminalError::ProjectNotFound);
        }
        entry
            .metadata
            .clone()
            .map(Some)
            .ok_or(TerminalError::RequestConflict)
    }
    pub fn generation(&self) -> String {
        self.lock().generation.clone()
    }
    pub fn set_closing(&self, closing: bool) {
        self.lock().closing = closing;
    }
    pub fn live_count(&self) -> usize {
        self.lock().quotas.total()
    }

    pub fn reserve(
        &self,
        request: CreateTerminalRequest,
        channel_id: u32,
    ) -> Result<Reservation, TerminalError> {
        for id in [
            &request.project_id,
            &request.root_id,
            &request.request_id,
            &request.generation,
        ] {
            validate_id(id)?;
        }
        validate_size(request.cols, request.rows)?;
        let mut registry = self.lock();
        if registry.generation != request.generation {
            return Err(TerminalError::ScopeMismatch);
        }
        if registry.closing {
            return Err(TerminalError::OwnerClosing);
        }
        if registry.deleted_projects.contains(&request.project_id) {
            return Err(TerminalError::ProjectNotFound);
        }
        if registry.deleted_projects.len() >= 1024 {
            return Err(TerminalError::LimitReached);
        }
        if registry.requests.contains_key(&request.request_id) {
            return Err(TerminalError::RequestConflict);
        }
        if registry.requests.len() >= 256 {
            return Err(TerminalError::LimitReached);
        }
        registry.quotas.reserve(&request.project_id)?;
        registry.next_id += 1;
        let terminal_id = format!("{}:{}", registry.generation, registry.next_id);
        let cancelled = Arc::new(AtomicBool::new(false));
        registry.entries.insert(
            terminal_id.clone(),
            Entry {
                metadata: None,
                session: None,
                transport: None,
                project_id: request.project_id.clone(),
                cancelled: cancelled.clone(),
                final_offset: 0,
                failed: false,
                resize_lock: Arc::new(Mutex::new(())),
            },
        );
        registry.requests.insert(
            request.request_id.clone(),
            (channel_id, terminal_id.clone(), request.clone()),
        );
        Ok(Reservation {
            manager: self.clone(),
            request,
            terminal_id,
            cancelled,
            committed: false,
        })
    }

    pub fn invalidate_project(&self, project_id: &str) {
        let mut registry = self.lock();
        // 删除记录保留到 owner 更换，阻止删除成功与后续异步创建交错产生孤儿会话。
        if registry.deleted_projects.len() >= 1024 {
            registry.closing = true;
        } else {
            registry.deleted_projects.insert(project_id.to_owned());
        }
        for entry in registry
            .entries
            .values()
            .filter(|entry| entry.project_id == project_id)
        {
            entry.cancelled.store(true, Ordering::Release);
        }
    }

    #[cfg(all(test, unix))]
    pub fn session(&self, scope: &TerminalScope) -> Result<Arc<Session>, TerminalError> {
        let registry = self.lock();
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
        entry.session.clone().ok_or(TerminalError::NotFound)
    }

    pub(super) fn lock(&self) -> std::sync::MutexGuard<'_, Registry> {
        self.registry
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

pub struct Reservation {
    pub(super) manager: TerminalManager,
    pub request: CreateTerminalRequest,
    pub terminal_id: String,
    cancelled: Arc<AtomicBool>,
    committed: bool,
}

impl Reservation {
    pub fn validate(&self) -> Result<(), TerminalError> {
        let registry = self.manager.lock();
        if registry.generation != self.request.generation {
            return Err(TerminalError::ScopeMismatch);
        }
        if registry.closing {
            return Err(TerminalError::OwnerClosing);
        }
        if self.cancelled.load(Ordering::Acquire) {
            return Err(TerminalError::ProjectNotFound);
        }
        Ok(())
    }

    #[cfg(all(test, unix))]
    pub fn commit(
        self,
        session: Arc<Session>,
        title: String,
    ) -> Result<TerminalMetadata, TerminalError> {
        self.commit_with_transport(session, title, None)
    }

    pub(crate) fn commit_with_transport(
        mut self,
        session: Arc<Session>,
        title: String,
        transport: Option<Arc<Transport>>,
    ) -> Result<TerminalMetadata, TerminalError> {
        let mut registry = self.manager.lock();
        let error = if registry.generation != self.request.generation {
            Some(TerminalError::ScopeMismatch)
        } else if registry.closing {
            Some(TerminalError::OwnerClosing)
        } else if self.cancelled.load(Ordering::Acquire) {
            Some(TerminalError::ProjectNotFound)
        } else {
            None
        };
        if let Some(error) = error {
            // spawn 期间删除项目或关闭 owner 时，先释放注册表锁，再回收刚创建的进程。
            drop(registry);
            if let Some(transport) = &transport {
                transport.cancel();
            }
            let cleanup = session.close().and_then(|()| {
                transport.as_ref().map_or(Ok(()), |transport| {
                    transport.join(std::time::Duration::from_millis(200))
                })
            });
            if cleanup.is_err() {
                return Err(self.retain_for_cleanup(session, title, transport));
            }
            return Err(error);
        }
        let entry = registry
            .entries
            .get_mut(&self.terminal_id)
            .ok_or(TerminalError::NotFound)?;
        let metadata = TerminalMetadata {
            scope: TerminalScope {
                project_id: self.request.project_id.clone(),
                terminal_id: self.terminal_id.clone(),
                generation: self.request.generation.clone(),
            },
            root_id: self.request.root_id.clone(),
            title: title.chars().take(128).collect(),
            state: TerminalState::Running,
            cols: self.request.cols,
            rows: self.request.rows,
            exit_code: None,
        };
        entry.metadata = Some(metadata.clone());
        let monitor = transport.is_some();
        entry.session = Some(session.clone());
        entry.transport = transport;
        self.committed = true;
        registry.publish(TerminalEvent::Created(metadata.clone()));
        registry.pending_changed.notify_all();
        drop(registry);
        if monitor {
            let manager = self.manager.clone();
            let scope = metadata.scope.clone();
            tauri::async_runtime::spawn(async move {
                let natural = session.wait_exit().await.is_ok();
                let _ =
                    tauri::async_runtime::spawn_blocking(move || manager.finish(&scope, natural))
                        .await;
            });
        }
        Ok(metadata)
    }

    pub(super) fn retain_for_cleanup(
        mut self,
        session: Arc<Session>,
        title: String,
        transport: Option<Arc<Transport>>,
    ) -> TerminalError {
        let mut registry = self.manager.lock();
        // 清理失败仍然拥有进程：保留原配额和句柄，让 owner 关闭能够重试。
        if let Some(entry) = registry.entries.get_mut(&self.terminal_id) {
            let metadata = TerminalMetadata {
                scope: TerminalScope {
                    project_id: self.request.project_id.clone(),
                    terminal_id: self.terminal_id.clone(),
                    generation: self.request.generation.clone(),
                },
                root_id: self.request.root_id.clone(),
                title: title.chars().take(128).collect(),
                state: TerminalState::Closing,
                cols: self.request.cols,
                rows: self.request.rows,
                exit_code: None,
            };
            entry.metadata = Some(metadata.clone());
            entry.session = Some(session);
            entry.transport = transport;
            entry.failed = true;
            self.committed = true;
            registry.publish(TerminalEvent::StateChanged(metadata));
            registry.pending_changed.notify_all();
        }
        TerminalError::CleanupFailed
    }
}

impl Registry {
    pub(super) fn transitioning() -> Self {
        Self {
            transitioning: true,
            ..Self::default()
        }
    }
    pub(super) fn snapshot(&self) -> TerminalSnapshot {
        let mut terminals: Vec<_> = self
            .entries
            .values()
            .filter_map(|entry| entry.metadata.clone())
            .collect();
        terminals.sort_by(|left, right| left.scope.terminal_id.cmp(&right.scope.terminal_id));
        TerminalSnapshot {
            generation: self.generation.clone(),
            sequence: DecimalU64(self.sequence),
            terminals,
        }
    }

    pub(super) fn publish(&mut self, event: TerminalEvent) {
        self.sequence += 1;
        if let Some(control) = &self.control
            && control
                .send(TerminalControlEvent {
                    sequence: DecimalU64(self.sequence),
                    event,
                })
                .is_err()
        {
            self.closing = true;
        }
    }
}

impl Drop for Reservation {
    fn drop(&mut self) {
        if self.committed {
            return;
        }
        let mut registry = self.manager.lock();
        if registry.entries.remove(&self.terminal_id).is_some() {
            registry.quotas.release(&self.request.project_id);
            registry.requests.remove(&self.request.request_id);
            registry.pending_changed.notify_all();
        }
    }
}
