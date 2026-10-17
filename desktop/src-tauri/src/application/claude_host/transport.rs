use serde_json::{Value, json};
use std::{
    collections::HashMap,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
};
use tokio::{
    io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, BufReader},
    sync::{OwnedSemaphorePermit, Semaphore, mpsc, oneshot},
    time::{Instant, timeout_at},
};
use tokio_util::sync::CancellationToken;

pub(super) const MAX_FRAME: usize = 8 * 1024 * 1024;
pub(super) const QUEUE_BYTES: usize = 16 * 1024 * 1024;
pub(super) const LANES: usize = 8;
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
    pub active_turns: Mutex<HashMap<String, (String, String)>>,
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
        crate::infrastructure::diagnostics::record_error("claude_host_transport_failed", reason);
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
                .map_err(|_| "Claude host closed")?;
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
                .map_err(|_| "Claude host closed")?;
            received.await.map_err(|_| "Claude host write failed")
        };
        tokio::select! {
            biased;
            _ = self.stopped.cancelled() => Err("Claude host disconnected".into()),
            result = timeout_at(deadline, operation) => match result {
                Ok(result) => result.map_err(str::to_owned),
                Err(_) => { self.fail("Claude host write deadline exceeded"); Err("Claude host request timed out".into()) }
            }
        }
    }

    pub async fn request(
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
                return Err("Claude host disconnected".into());
            }
            if pending.len() >= 32 {
                return Err("Claude request capacity exceeded".into());
            }
            pending.insert(id, sender);
        }
        // 外部调用取消时也移除 sender，不能把取消的请求永久计入容量。
        let _registration = Registration {
            transport: self,
            id,
        };
        let operation = async {
            self.write(
                &json!({"id":id,"method":method,"scope":scope,"params":params}),
                deadline,
            )
            .await?;
            receiver
                .await
                .map_err(|_| "Claude host closed".to_owned())?
        };
        match timeout_at(deadline, operation).await {
            Ok(result) => result,
            Err(_) => {
                self.fail("Claude host request deadline exceeded");
                Err("Claude host request timed out".into())
            }
        }
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
}
impl Drop for Registration<'_> {
    fn drop(&mut self) {
        self.transport
            .pending
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&self.id);
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
            transport.fail("Claude host pipe write failed or timed out");
            return;
        }
        let _ = frame.written.send(());
    }
}

fn enqueue(
    sender: &mpsc::Sender<Routed>,
    message: Value,
    size: usize,
    transport: &Transport,
) -> Result<(), &'static str> {
    let budget = Arc::clone(&transport.inbound_budget)
        .try_acquire_many_owned(size as u32)
        .map_err(|_| "Claude host inbound byte budget exceeded")?;
    // reader 绝不等待慢消费者；关键帧不能静默丢弃，预算耗尽时显式断连恢复。
    sender
        .try_send(Routed {
            message,
            _budget: budget,
        })
        .map_err(|_| "Claude host inbound queue capacity exceeded")
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
                .map_err(|_| "Claude host stdout read failed")?;
            if size == 0 {
                return Err("Claude host stdout closed");
            }
            if size > MAX_FRAME {
                return Err("Claude host stdout frame budget exceeded");
            }
            if line.last() != Some(&b'\n') {
                return Err("Claude host truncated stdout frame");
            }
            let message: Value =
                serde_json::from_slice(&line).map_err(|_| "Claude host invalid stdout JSON")?;
            if message["catalogId"].as_u64().is_some() {
                enqueue(&catalog, message, size, &transport)?;
            } else if message["id"].as_u64().is_some() && message["snapshotProjectId"].is_null() {
                transport.respond(message);
            } else if message["event"].is_object() || message["snapshotProjectId"].is_string() {
                let project = message["snapshotProjectId"]
                    .as_str()
                    .or_else(|| message["projectId"].as_str())
                    .ok_or("Claude host missing project identity")?;
                if project.len() > 1024
                    || ["taskId", "turnId"].iter().any(|key| {
                        message["event"][key]
                            .as_str()
                            .is_some_and(|id| id.len() > 1024)
                    })
                {
                    return Err("Claude host identity budget exceeded");
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
                            return Err("Claude host active task capacity exceeded");
                        }
                        active.insert(task.to_owned(), (project.to_owned(), turn.to_owned()));
                    }
                }
                enqueue(&lanes[lane], message, size, &transport)?;
            } else {
                return Err("Claude host invalid stdout envelope");
            }
        }
    }
    .await;
    if let Err(reason) = result {
        transport.fail(reason);
    }
}
