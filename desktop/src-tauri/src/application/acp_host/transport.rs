use serde_json::{Value, json};
use std::{
    collections::HashMap,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};
use tokio::{
    io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, BufReader},
    sync::{OwnedSemaphorePermit, Semaphore, mpsc, oneshot},
    time::{Instant, timeout, timeout_at},
};
use tokio_util::sync::CancellationToken;

pub(super) const MAX_FRAME: usize = 8 * 1024 * 1024;
pub(super) const QUEUE_BYTES: usize = 16 * 1024 * 1024;
pub(super) const LANES: usize = 8;
const EVENT_QUEUE_STALL: Duration = Duration::from_secs(3);
/// 仅公布可安全撤销的 ACP 全局操作；配置写入不能据等待取消推断提交失败。
pub(crate) fn cancellable_acp_request(method: &str) -> bool {
    matches!(
        method,
        "agent.authenticate"
            | "agent.inspect"
            | "agent.quota"
            | "agents.list"
            | "agents.progress"
            | "settings.read"
            | "settings.preview"
            | "providers.list"
            | "application.generate"
    )
}
type Reply = oneshot::Sender<Result<Value, String>>;

pub(super) struct Outbound {
    bytes: Vec<u8>,
    deadline: Instant,
    written: oneshot::Sender<()>,
    _budget: OwnedSemaphorePermit,
}
pub(super) struct Routed {
    pub message: Value,
    pub _budget: OwnedSemaphorePermit,
}

/// 请求、写入和断连共用同一个生命周期；短锁中不执行 I/O 或 await。
pub(super) struct Transport {
    pub stopped: CancellationToken,
    pending: Mutex<HashMap<u64, Reply>>,
    next_id: AtomicU64,
    writer: mpsc::Sender<Outbound>,
    write_budget: Arc<Semaphore>,
    pub inbound_budget: Arc<Semaphore>,
    pub active_turns: Mutex<HashMap<String, (String, String, String)>>,
}

impl Transport {
    pub fn new() -> (Arc<Self>, mpsc::Receiver<Outbound>) {
        let (writer, receiver) = mpsc::channel(64);
        (
            Arc::new(Self {
                stopped: CancellationToken::new(),
                pending: Mutex::default(),
                next_id: AtomicU64::new(1),
                writer,
                write_budget: Arc::new(Semaphore::new(MAX_FRAME)),
                inbound_budget: Arc::new(Semaphore::new(QUEUE_BYTES)),
                active_turns: Mutex::default(),
            }),
            receiver,
        )
    }

    pub fn fail(&self, reason: &'static str) {
        // 先持有登记锁再取消，确保并发新请求不会落入 drain 之后的空隙。
        let mut pending = self.pending.lock().unwrap_or_else(|e| e.into_inner());
        if self.stopped.is_cancelled() {
            return;
        }
        self.stopped.cancel();
        for (_, sender) in pending.drain() {
            let _ = sender.send(Err(reason.to_owned()));
        }
        crate::infrastructure::diagnostics::record_error("acp_host_transport_failed", reason);
    }

    pub fn respond(&self, mut message: Value) {
        if let Some(id) = message["id"].as_u64()
            && let Some(sender) = self
                .pending
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .remove(&id)
        {
            let result = match message["error"].as_str() {
                Some(error) => Err(error.to_owned()),
                None => Ok(message["result"].take()),
            };
            let _ = sender.send(result);
        }
    }

    pub async fn write(&self, message: &Value, deadline: Instant) -> Result<(), String> {
        // 先计算有限长度并取得字节许可，再分配序列化缓冲，避免排队者在队列外各留一份大帧。
        let mut length = FrameLength(1);
        serde_json::to_writer(&mut length, message)
            .map_err(|_| "Claude frame exceeds transport budget")?;
        let operation = async {
            let budget = Arc::clone(&self.write_budget)
                .acquire_many_owned(length.0 as u32)
                .await
                .map_err(|_| "ACP host closed")?;
            let mut bytes = Vec::with_capacity(length.0);
            serde_json::to_writer(&mut bytes, message)
                .map_err(|_| "Claude frame encoding failed")?;
            bytes.push(b'\n');
            let (written, received) = oneshot::channel();
            self.writer
                .send(Outbound {
                    bytes,
                    deadline,
                    written,
                    _budget: budget,
                })
                .await
                .map_err(|_| "ACP host closed")?;
            received.await.map_err(|_| "ACP host write failed")
        };
        tokio::select! {
            biased;
            _ = self.stopped.cancelled() => Err("ACP host disconnected".into()),
            result = timeout_at(deadline, operation) => match result {
                Ok(result) => result.map_err(str::to_owned),
                Err(_) => { self.fail("ACP host write deadline exceeded"); Err("ACP host request timed out".into()) }
            }
        }
    }

    pub async fn request_acp(
        &self,
        method: &str,
        scope: Option<Value>,
        params: Value,
        deadline: Instant,
    ) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (sender, receiver) = oneshot::channel();
        {
            let mut pending = self.pending.lock().unwrap_or_else(|e| e.into_inner());
            if self.stopped.is_cancelled() {
                return Err("ACP host disconnected".into());
            }
            if pending.len() >= 32 {
                return Err("ACP request capacity exceeded".into());
            }
            pending.insert(id, sender);
        }
        // 外部调用取消时也移除 sender，不能把取消的请求永久计入容量。
        let _registration = Registration {
            transport: self,
            id,
            cancel_search: method == "search.occurrences"
                || cancellable_acp_request(method)
                || matches!(
                    method,
                    "task.read" | "session.config.read" | "session.state.read" | "queue.list"
                ),
        };
        let operation = async {
            self.write(
                &json!({"id":id,"method":method,"scope":scope,"params":params}),
                deadline,
            )
            .await?;
            receiver.await.map_err(|_| "ACP host closed".to_owned())?
        };
        timeout_at(deadline, operation)
            .await
            .map_err(|_| "ACP host request timed out".to_owned())?
    }
}

struct FrameLength(usize);
impl std::io::Write for FrameLength {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        if bytes.len() > MAX_FRAME.saturating_sub(self.0) {
            return Err(std::io::Error::other("frame budget exceeded"));
        }
        self.0 += bytes.len();
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

struct Registration<'a> {
    transport: &'a Transport,
    id: u64,
    cancel_search: bool,
}
impl Drop for Registration<'_> {
    fn drop(&mut self) {
        let pending = self
            .transport
            .pending
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&self.id)
            .is_some();
        if pending && self.cancel_search && !self.transport.stopped.is_cancelled() {
            // 搜索和 ACP 服务取消仅定位当前请求；小控制帧进入有界队列，不创建后台等待任务。
            let bytes = format!("{{\"cancelId\":{}}}\n", self.id).into_bytes();
            if let Ok(budget) =
                Arc::clone(&self.transport.write_budget).try_acquire_many_owned(bytes.len() as u32)
            {
                let (written, _) = oneshot::channel();
                let _ = self.transport.writer.try_send(Outbound {
                    bytes,
                    deadline: Instant::now() + std::time::Duration::from_secs(1),
                    written,
                    _budget: budget,
                });
            }
        }
    }
}

/// 唯一 writer 保证帧不交错；部分写入超时意味着帧边界已不可信，必须断开整条传输。
pub(super) async fn writer_loop<W: AsyncWrite + Unpin>(
    mut writer: W,
    mut receiver: mpsc::Receiver<Outbound>,
    transport: Arc<Transport>,
) {
    while let Some(frame) = receiver.recv().await {
        let result = tokio::select! {
            biased;
            _ = transport.stopped.cancelled() => return,
            result = timeout_at(frame.deadline, writer.write_all(&frame.bytes)) => result,
        };
        if !matches!(result, Ok(Ok(()))) {
            transport.fail("ACP host pipe write failed or timed out");
            return;
        }
        let _ = frame.written.send(());
    }
}

fn reserve_frame(
    message: Value,
    size: usize,
    transport: &Transport,
) -> Result<Routed, &'static str> {
    let budget = Arc::clone(&transport.inbound_budget)
        .try_acquire_many_owned(size as u32)
        .map_err(|_| "ACP host inbound byte budget exceeded")?;
    Ok(Routed {
        message,
        _budget: budget,
    })
}

async fn enqueue_event(
    sender: &mpsc::Sender<Routed>,
    frame: Routed,
    stopped: &CancellationToken,
) -> Result<(), &'static str> {
    let frame = match sender.try_send(frame) {
        Ok(()) => return Ok(()),
        Err(mpsc::error::TrySendError::Full(frame)) => frame,
        Err(mpsc::error::TrySendError::Closed(_)) => return Err("ACP host event consumer closed"),
    };
    // 事件突发时只保留一个已计入字节预算的待投递帧，通过管道背压等待队列短暂腾空。
    // 项目内的事件和快照依次交付，消费者持续停滞才结束传输，避免无限阻塞后续请求。
    tokio::select! {
        biased;
        _ = stopped.cancelled() => Err("ACP host stopped"),
        result = timeout(EVENT_QUEUE_STALL, sender.send(frame)) => match result {
            Ok(Ok(())) => Ok(()),
            Ok(Err(_)) => Err("ACP host event consumer closed"),
            Err(_) => Err("ACP host event queue stalled"),
        }
    }
}

pub(super) async fn reader_loop<R: AsyncRead + Unpin>(
    reader: R,
    transport: Arc<Transport>,
    catalog: mpsc::Sender<Routed>,
    lanes: Vec<mpsc::Sender<Routed>>,
) {
    let mut reader = BufReader::new(reader);
    let mut line = Vec::new();
    let result: Result<(), &'static str> = async {
        loop {
            line.clear();
            let size = (&mut reader)
                .take((MAX_FRAME + 1) as u64)
                .read_until(b'\n', &mut line)
                .await
                .map_err(|_| "ACP host stdout read failed")?;
            if size == 0 {
                return Err("ACP host stdout closed");
            }
            if size > MAX_FRAME {
                return Err("ACP host stdout frame budget exceeded");
            }
            if line.last() != Some(&b'\n') {
                return Err("ACP host truncated stdout frame");
            }
            let message: Value =
                serde_json::from_slice(&line).map_err(|_| "ACP host invalid stdout JSON")?;
            if message["catalogId"].as_u64().is_some() {
                catalog
                    .try_send(reserve_frame(message, size, &transport)?)
                    .map_err(|_| "ACP host inbound catalog queue unavailable")?;
            } else if message["id"].as_u64().is_some() && message["snapshotProjectId"].is_null() {
                transport.respond(message);
            } else if message["event"].is_object() || message["snapshotProjectId"].is_string() {
                let project = message["snapshotProjectId"]
                    .as_str()
                    .or_else(|| message["projectId"].as_str())
                    .ok_or("ACP host missing project identity")?;
                if project.len() > 1024
                    || ["taskId", "turnId"].iter().any(|key| {
                        message["event"][key]
                            .as_str()
                            .is_some_and(|id| id.len() > 1024)
                    })
                {
                    return Err("ACP host identity budget exceeded");
                }
                // 固定项目分片保留项目内事件/快照屏障，任务数增加不会创建更多后台任务。
                let lane = project.bytes().fold(0usize, |hash, b| {
                    hash.wrapping_mul(31).wrapping_add(b as usize)
                }) % lanes.len();
                if message["event"]["type"] == "turn.started" {
                    let event = &message["event"];
                    if let (Some(task), Some(turn)) =
                        (event["taskId"].as_str(), event["turnId"].as_str())
                    {
                        let mut active = transport
                            .active_turns
                            .lock()
                            .unwrap_or_else(|e| e.into_inner());
                        if active.len() >= 512 && !active.contains_key(task) {
                            return Err("ACP host active task capacity exceeded");
                        }
                        let engine = event["provider"]
                            .as_str()
                            .filter(|value| matches!(*value, "codex" | "claude"))
                            .unwrap_or("claude");
                        active.insert(
                            task.to_owned(),
                            (project.to_owned(), turn.to_owned(), engine.to_owned()),
                        );
                    }
                }
                let frame = reserve_frame(message, size, &transport)?;
                enqueue_event(&lanes[lane], frame, &transport.stopped).await?;
            } else {
                return Err("ACP host invalid stdout envelope");
            }
        }
    }
    .await;
    if let Err(reason) = result {
        transport.fail(reason);
    }
}
