use std::{
    collections::HashMap,
    path::Path,
    pin::Pin,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};

use serde::{Serialize, de::DeserializeOwned};
use serde_json::value::RawValue;
use thiserror::Error;
use tokio::{
    io::{AsyncBufRead, AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader},
    sync::{Mutex as AsyncMutex, mpsc, oneshot},
    task::JoinHandle,
    time::{Instant, sleep, timeout_at},
};

use crate::infrastructure::diagnostics;

use super::connection_event_buffer::NotificationBuffer;
use super::connection_message_channel::{
    ServerMessageReceiver, ServerMessageSender, server_message_channel,
};
use super::generated_image_store::GeneratedImageStore;
use super::model_cache::ModelCatalogCache;
use super::protocol::{
    ClientInfo, IGNORED_NOTIFICATION_METHODS, IncomingMessage, InitializeCapabilities,
    InitializeParams, InitializeResponse, RpcError, encode_notification, encode_request,
    encode_response,
};

#[path = "connection_lifecycle.rs"]
mod lifecycle;
#[path = "connection_reader.rs"]
mod reader;
use lifecycle::PendingRegistration;
use reader::read_responses;

type PendingResult = Result<Box<RawValue>, PendingError>;
type PendingRequests = Arc<Mutex<HashMap<u64, oneshot::Sender<PendingResult>>>>;
type AsyncWriter = Pin<Box<dyn AsyncWrite + Send>>;
const OVERLOAD_RETRY_DELAYS: [Duration; 2] =
    [Duration::from_millis(25), Duration::from_millis(100)];
const NOTIFICATION_OVERFLOW_CAPACITY: usize = 256;
// 普通 JSONL 帧控制在 8 MiB；图片帧为 50 MiB 解码内容预留 Base64 和信封空间。
pub(super) const MAX_STANDARD_FRAME_BYTES: usize = 8 * 1024 * 1024;
pub(super) const MAX_IMAGE_FRAME_BYTES: usize = 72 * 1024 * 1024;

#[derive(Clone, Debug)]
enum PendingError {
    Request(RpcError),
    ConnectionClosed,
    InvalidMessage,
}

#[derive(Debug, Error)]
pub enum ConnectionError {
    #[error("failed to process app-server JSON: {0}")]
    Json(#[from] serde_json::Error),
    #[error("failed to write app-server message: {0}")]
    Write(#[from] std::io::Error),
    #[error("app-server request failed with code {code}: {message}")]
    Request { code: i64, message: String },
    #[error("app-server connection closed")]
    ConnectionClosed,
    #[error("app-server returned an invalid response")]
    InvalidMessage,
    #[error("app-server request timed out")]
    Timeout,
    #[error("app-server request state is unavailable")]
    StateUnavailable,
}

pub struct AppServerConnection {
    pub(super) queued_media: Option<crate::infrastructure::queued_media::QueuedMediaStore>,
    diagnostic_seq: u64,
    pub(super) model_catalog: Arc<ModelCatalogCache>,
    // 仅当前连接创建且尚未确认落盘的线程需要保留项目归属。
    pub(super) new_task_projects: Mutex<HashMap<String, String>>,
    // 新建任务仅保留首次标题生成所需的目录；领取后立即移除，重连不继承。
    pub(super) pending_task_titles: Mutex<HashMap<String, String>>,
    pub(super) title_mutation: AsyncMutex<()>,
    writer: AsyncMutex<Option<AsyncWriter>>,
    pending: PendingRequests,
    server_messages: AsyncMutex<Option<ServerMessageReceiver>>,
    next_id: AtomicU64,
    reader_task: JoinHandle<()>,
}

#[derive(Debug)]
pub struct ServerMessage {
    pub id: Option<u64>,
    pub method: String,
    pub params: Box<RawValue>,
}

impl AppServerConnection {
    #[cfg(test)]
    pub fn new<R, W>(reader: R, writer: W) -> Self
    where
        R: AsyncRead + Send + Unpin + 'static,
        W: AsyncWrite + Send + Unpin + 'static,
    {
        Self::build(reader, writer, None)
    }

    pub fn with_image_store<R, W>(reader: R, writer: W, app_data: &Path) -> Self
    where
        R: AsyncRead + Send + Unpin + 'static,
        W: AsyncWrite + Send + Unpin + 'static,
    {
        Self::build(reader, writer, Some(app_data))
    }

    fn build<R, W>(reader: R, writer: W, app_data: Option<&Path>) -> Self
    where
        R: AsyncRead + Send + Unpin + 'static,
        W: AsyncWrite + Send + Unpin + 'static,
    {
        let diagnostic_seq = super::connection_diagnostics::next_connection_seq();
        let pending = Arc::new(Mutex::new(HashMap::new()));
        let reader_pending = Arc::clone(&pending);
        let (message_sender, message_receiver) = server_message_channel(256);
        let model_catalog = Arc::new(ModelCatalogCache::default());
        let reader_task = tokio::spawn(read_responses(
            reader,
            reader_pending,
            message_sender,
            app_data.map(GeneratedImageStore::new),
            Arc::clone(&model_catalog),
            diagnostic_seq,
        ));

        Self {
            queued_media: app_data.map(crate::infrastructure::queued_media::QueuedMediaStore::new),
            diagnostic_seq,
            model_catalog,
            new_task_projects: Mutex::new(HashMap::new()),
            pending_task_titles: Mutex::new(HashMap::new()),
            title_mutation: AsyncMutex::new(()),
            writer: AsyncMutex::new(Some(Box::pin(writer))),
            pending,
            server_messages: AsyncMutex::new(Some(message_receiver)),
            next_id: AtomicU64::new(1),
            reader_task,
        }
    }

    pub fn diagnostic_seq(&self) -> u64 {
        self.diagnostic_seq
    }

    pub async fn take_server_messages(&self) -> Result<ServerMessageReceiver, ConnectionError> {
        self.server_messages
            .lock()
            .await
            .take()
            .ok_or(ConnectionError::StateUnavailable)
    }

    pub async fn initialize(
        &self,
        request_timeout: Duration,
    ) -> Result<InitializeResponse, ConnectionError> {
        let params = InitializeParams {
            client_info: ClientInfo {
                name: "codeagent",
                title: Some("Codexly"),
                version: env!("CARGO_PKG_VERSION"),
            },
            capabilities: InitializeCapabilities {
                experimental_api: true,
                opt_out_notification_methods: IGNORED_NOTIFICATION_METHODS,
            },
        };
        let response = self.request("initialize", &params, request_timeout).await?;
        self.notify("initialized").await?;
        Ok(response)
    }

    pub async fn request<P, R>(
        &self,
        method: &str,
        params: &P,
        request_timeout: Duration,
    ) -> Result<R, ConnectionError>
    where
        P: Serialize,
        R: DeserializeOwned,
    {
        // 一次调用共享总截止时间，排队、写入、响应以及过载退避均消耗同一预算。
        let started = Instant::now();
        let deadline = started + request_timeout;
        let mut observation = super::connection_diagnostics::RpcObservation::start(
            method,
            self.diagnostic_seq,
            request_timeout,
        );
        let result = timeout_at(deadline, async {
            for delay in OVERLOAD_RETRY_DELAYS {
                match self.request_once(method, params, &mut observation).await {
                    Err(ConnectionError::Request { code: -32001, .. }) => {
                        observation.phase = "retry_backoff";
                        sleep(delay).await;
                        observation.retry_count += 1;
                    }
                    result => return result,
                }
            }
            self.request_once(method, params, &mut observation).await
        })
        .await
        .unwrap_or(Err(ConnectionError::Timeout));
        observation.finish(&result);
        result
    }

    async fn request_once<P, R>(
        &self,
        method: &str,
        params: &P,
        observation: &mut super::connection_diagnostics::RpcObservation<'_>,
    ) -> Result<R, ConnectionError>
    where
        P: Serialize,
        R: DeserializeOwned,
    {
        let _catalog_change = self.model_catalog.changing_for_request(method);
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        observation.request_seq = Some(id);
        observation.phase = "encode";
        let message = encode_request(id, method, params)?;
        let (sender, receiver) = oneshot::channel();

        let _registration = PendingRegistration::new(&self.pending, id, sender)?;
        self.write_message_tracked(&message, Some(&mut observation.phase))
            .await?;
        observation.phase = "response";
        let response = receiver
            .await
            .map_err(|_| ConnectionError::ConnectionClosed)?;

        observation.phase = "decode";
        match response {
            Ok(result) => serde_json::from_str(result.get()).map_err(ConnectionError::Json),
            Err(PendingError::Request(error)) => Err(ConnectionError::Request {
                code: error.code,
                message: error.message,
            }),
            Err(PendingError::ConnectionClosed) => Err(ConnectionError::ConnectionClosed),
            Err(PendingError::InvalidMessage) => Err(ConnectionError::InvalidMessage),
        }
    }

    async fn notify(&self, method: &str) -> Result<(), ConnectionError> {
        let message = encode_notification(method)?;
        self.write_message(&message).await
    }

    pub async fn respond<R: Serialize>(&self, id: u64, result: &R) -> Result<(), ConnectionError> {
        let message = encode_response(id, result)?;
        self.write_message(&message).await
    }
}

impl Drop for AppServerConnection {
    fn drop(&mut self) {
        self.reader_task.abort();
    }
}

#[derive(Debug)]
pub(super) enum FrameReadError {
    Io(std::io::Error),
    TooLarge,
}

impl From<std::io::Error> for FrameReadError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

pub(super) async fn read_bounded_frame<R>(
    reader: &mut R,
    frame: &mut Vec<u8>,
    standard_limit: usize,
    image_limit: usize,
) -> Result<bool, FrameReadError>
where
    R: AsyncBufRead + Unpin,
{
    let mut is_image = false;
    let mut scan_from = 0;

    loop {
        let buffer = reader.fill_buf().await?;
        if buffer.is_empty() {
            return Ok(!frame.is_empty());
        }

        let newline = memchr::memchr(b'\n', buffer);
        let data_len = newline.unwrap_or(buffer.len());
        let limit = if is_image {
            image_limit
        } else {
            standard_limit
        };
        // 只复制预算内字节，保证恶意无换行输入不会先触发超额扩容。
        let copy_len = data_len.min(limit.saturating_sub(frame.len()));
        frame.extend_from_slice(&buffer[..copy_len]);

        // 队列图片/音频也以内联快照返回，使用同一个有界媒体帧预算。
        let scanned = &frame[scan_from..];
        if !is_image
            && (GeneratedImageStore::contains_image_generation(scanned)
                || memchr::memmem::find(scanned, b"data:image/").is_some()
                || memchr::memmem::find(scanned, b"data:audio/").is_some())
        {
            is_image = true;
        }
        scan_from = frame
            .len()
            .saturating_sub(GeneratedImageStore::marker_len().saturating_sub(1));
        reader.consume(copy_len);

        if copy_len < data_len {
            if is_image && frame.len() < image_limit {
                continue;
            }
            return Err(FrameReadError::TooLarge);
        }
        if newline.is_some() {
            reader.consume(1);
            return Ok(true);
        }
    }
}

fn route_response(pending: &PendingRequests, message: IncomingMessage) {
    if message.method.is_some() {
        return;
    }
    let Some(id) = message.id else {
        return;
    };
    let sender = match pending.lock() {
        Ok(mut requests) => requests.remove(&id),
        Err(_) => None,
    };
    let Some(sender) = sender else {
        return;
    };

    let response = match (message.result, message.error) {
        (Some(result), _) => Ok(result),
        (_, Some(error)) => Err(PendingError::Request(error)),
        _ => Err(PendingError::InvalidMessage),
    };
    let _ = sender.send(response);
}

fn fail_pending(pending: &PendingRequests, error: PendingError) {
    let requests = match pending.lock() {
        Ok(mut requests) => std::mem::take(&mut *requests),
        Err(_) => return,
    };
    for sender in requests.into_values() {
        let _ = sender.send(Err(error.clone()));
    }
}

#[cfg(test)]
#[path = "connection_frame_cancellation_tests.rs"]
mod frame_cancellation_tests;

#[cfg(test)]
#[path = "connection_request_lifecycle_tests.rs"]
mod request_lifecycle_tests;

#[cfg(test)]
#[path = "connection_logging_tests.rs"]
mod logging_tests;
