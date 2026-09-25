use super::{flow_control::FlowControl, input_queue::InputQueue, session::Session};
use crate::domain::project_terminal::{TerminalError, encode_frame};
use std::{
    io::Write,
    sync::{
        Arc, Condvar, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    thread::JoinHandle,
    time::Duration,
};
use tauri::ipc::{Channel, Response};

pub(crate) struct Transport {
    session: Arc<Session>,
    flow: FlowControl,
    input: InputQueue,
    cancelled: AtomicBool,
    completion: (Mutex<(bool, bool)>, Condvar),
    workers: Mutex<Vec<JoinHandle<()>>>,
}

impl Transport {
    pub fn start(
        session: Arc<Session>,
        channel: Channel<Response>,
        failure: Arc<dyn Fn() + Send + Sync>,
    ) -> Result<Arc<Self>, TerminalError> {
        let (mut reader, mut writer) = session.take_io()?;
        let transport = Arc::new(Self {
            session,
            flow: FlowControl::default(),
            input: InputQueue::default(),
            cancelled: AtomicBool::new(false),
            completion: (Mutex::new((false, false)), Condvar::new()),
            workers: Mutex::new(Vec::with_capacity(2)),
        });
        let reading = transport.clone();
        let read_failure = failure.clone();
        let read_worker = std::thread::Builder::new()
            .name("terminal-reader".into())
            .spawn(move || {
                let result = (|| {
                    let mut bytes = [0; 16384];
                    loop {
                        let budget = reading.flow.read_budget()?;
                        let mut count = reader
                            .read(&mut bytes[..budget])
                            .map_err(|_| TerminalError::StreamInvalid)?;
                        if count == 0 {
                            return Ok::<(), TerminalError>(());
                        }
                        // 只在首块到达后开启短暂合并窗口；满块立即发送，空闲没有周期唤醒。
                        let deadline = std::time::Instant::now() + Duration::from_millis(4);
                        while count < budget {
                            let remaining =
                                deadline.saturating_duration_since(std::time::Instant::now());
                            if remaining.is_zero()
                                || !reader
                                    .read_ready(remaining)
                                    .map_err(|_| TerminalError::StreamInvalid)?
                            {
                                break;
                            }
                            let next = reader
                                .read(&mut bytes[count..budget])
                                .map_err(|_| TerminalError::StreamInvalid)?;
                            if next == 0 {
                                break;
                            }
                            count += next;
                        }
                        let (sequence, offset) = reading.flow.sent(count)?;
                        channel
                            .send(Response::new(encode_frame(
                                sequence,
                                offset,
                                &bytes[..count],
                            )?))
                            .map_err(|_| TerminalError::StreamInvalid)?;
                    }
                })();
                reading.mark_finished(true);
                if result.is_err() && !reading.cancelled.load(Ordering::Acquire) {
                    read_failure();
                }
            })
            .map_err(|_| TerminalError::SpawnFailed)?;
        transport
            .workers
            .lock()
            .map_err(|_| TerminalError::SpawnFailed)?
            .push(read_worker);
        let writing = transport.clone();
        let write_worker = std::thread::Builder::new()
            .name("terminal-writer".into())
            .spawn(move || {
                while let Some(bytes) = writing.input.take() {
                    let result = writer.write_all(&bytes);
                    writing.input.consumed(bytes.len());
                    if result.is_err() {
                        if !writing.cancelled.load(Ordering::Acquire) {
                            failure();
                        }
                        break;
                    }
                }
                writing.mark_finished(false);
            });
        match write_worker {
            Ok(worker) => transport
                .workers
                .lock()
                .map_err(|_| TerminalError::SpawnFailed)?
                .push(worker),
            Err(_) => {
                transport.cancel();
                transport.mark_finished(false);
                transport.join(Duration::from_secs(1))?;
                return Err(TerminalError::SpawnFailed);
            }
        }
        Ok(transport)
    }

    pub fn write(&self, sequence: u64, bytes: &[u8]) -> Result<(), TerminalError> {
        self.input.accept(sequence, bytes)
    }
    pub fn ack(&self, offset: u64) -> Result<(), TerminalError> {
        self.flow.ack(offset)
    }
    pub fn final_offset(&self) -> u64 {
        self.flow.final_offset()
    }
    #[cfg(any(all(test, unix), feature = "webview-tests"))]
    pub fn outstanding_bytes(&self) -> u64 {
        self.flow.outstanding()
    }
    #[cfg(feature = "webview-tests")]
    pub fn queued_input_bytes(&self) -> usize {
        self.input.bytes()
    }

    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
        self.input.cancel();
        self.flow.cancel();
        self.session.cancel_io();
    }

    pub fn wait_reader(&self, timeout: Duration) -> bool {
        let (done, wake) = &self.completion;
        let done = done
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let (done, _) = wake
            .wait_timeout_while(done, timeout, |done| !done.0)
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        done.0
    }

    pub fn join(&self, timeout: Duration) -> Result<(), TerminalError> {
        let (done, wake) = &self.completion;
        let done = done.lock().map_err(|_| TerminalError::CleanupFailed)?;
        let (done, _) = wake
            .wait_timeout_while(done, timeout, |done| !(done.0 && done.1))
            .map_err(|_| TerminalError::CleanupFailed)?;
        if !(done.0 && done.1) {
            return Err(TerminalError::CleanupFailed);
        }
        drop(done);
        for worker in self
            .workers
            .lock()
            .map_err(|_| TerminalError::CleanupFailed)?
            .drain(..)
        {
            worker.join().map_err(|_| TerminalError::CleanupFailed)?;
        }
        Ok(())
    }

    fn mark_finished(&self, reader: bool) {
        let (done, wake) = &self.completion;
        let mut done = done
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if reader {
            done.0 = true;
        } else {
            done.1 = true;
        }
        wake.notify_all();
    }
}
