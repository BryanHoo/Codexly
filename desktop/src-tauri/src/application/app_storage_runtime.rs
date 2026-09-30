use std::{collections::BTreeMap, path::PathBuf};

use tokio::sync::{Mutex, mpsc, watch};

use super::error::AppError;
use crate::infrastructure::app_storage;

#[cfg(test)]
#[path = "app_storage_writer_tests.rs"]
mod tests;

const PREFERENCE_QUEUE_CAPACITY: usize = 64;
const PREFERENCE_WRITE_DELAY: std::time::Duration = std::time::Duration::from_millis(100);
const PREFERENCE_RETRY_DELAY: std::time::Duration = std::time::Duration::from_secs(1);
const PREFERENCE_MAX_WRITE_ATTEMPTS: usize = 3;
const PREFERENCE_ENQUEUE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(1);
const PREFERENCE_SHUTDOWN_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

type PreferenceUpdates = BTreeMap<String, Option<String>>;
type FlushCompletion = watch::Sender<Option<bool>>;

enum PreferenceWriterMessage {
    Updates(PreferenceUpdates),
    Flush(FlushCompletion),
}

#[derive(Default)]
pub(crate) struct AppStorageRuntime {
    state: Mutex<StorageWriterState>,
}

#[derive(Default)]
struct StorageWriterState {
    closing: bool,
    sender: Option<mpsc::Sender<PreferenceWriterMessage>>,
    completion: Option<watch::Receiver<Option<bool>>>,
    shutdown_generation: u64,
}

#[derive(Default)]
pub(super) struct PreferenceWriteBuffer {
    updates: PreferenceUpdates,
}

impl PreferenceWriteBuffer {
    pub(super) fn merge(&mut self, updates: PreferenceUpdates) {
        self.updates.extend(updates);
    }

    pub(super) fn take(&mut self) -> PreferenceUpdates {
        std::mem::take(&mut self.updates)
    }

    pub(super) fn restore_failed(&mut self, updates: PreferenceUpdates) {
        // 已进入缓冲的新值优先于失败批次中的旧值。
        for (key, value) in updates {
            self.updates.entry(key).or_insert(value);
        }
    }

    pub(super) fn is_empty(&self) -> bool {
        self.updates.is_empty()
    }
}

impl AppStorageRuntime {
    pub(crate) async fn enqueue(
        &self,
        app_data: PathBuf,
        updates: PreferenceUpdates,
    ) -> Result<(), AppError> {
        let sender = {
            let mut state = self.state.lock().await;
            if state.closing {
                return Err(AppError::FilesystemRequestFailed);
            }
            if state.sender.is_none() {
                state.sender = Some(spawn_preference_writer(app_data));
            }
            // writer 异常退出时拒绝新写入，不能重建并掩盖已接收数据的丢失。
            state
                .sender
                .clone()
                .ok_or(AppError::FilesystemRequestFailed)?
        };
        // 锁外等待容量，底层 I/O 卡住时不阻塞关闭或其他状态操作。
        let permit = tokio::time::timeout(PREFERENCE_ENQUEUE_TIMEOUT, sender.reserve_owned())
            .await
            .map_err(|_| AppError::FilesystemRequestFailed)?
            .map_err(|_| AppError::FilesystemRequestFailed)?;
        let state = self.state.lock().await;
        if state.closing {
            return Err(AppError::FilesystemRequestFailed);
        }
        // 接受写入与建立关闭屏障在同一锁内完成，预留槽位不代表已接受更新。
        permit.send(PreferenceWriterMessage::Updates(updates));
        Ok(())
    }

    pub(crate) async fn shutdown(&self) -> Result<(), AppError> {
        let deadline = tokio::time::Instant::now() + PREFERENCE_SHUTDOWN_TIMEOUT;
        let (generation, completion) = tokio::time::timeout_at(deadline, async {
            let sender = {
                let mut state = self.state.lock().await;
                if state.closing {
                    return Ok((state.shutdown_generation, state.completion.clone()));
                }
                match state.sender.clone() {
                    Some(sender) => sender,
                    None => {
                        state.closing = true;
                        state.shutdown_generation = state.shutdown_generation.wrapping_add(1);
                        return Ok((state.shutdown_generation, None));
                    }
                }
            };
            // 先在锁外取得槽位；等待者取消或队列超时不会留下半关闭状态。
            let permit = sender
                .reserve_owned()
                .await
                .map_err(|_| AppError::FilesystemRequestFailed)?;
            let mut state = self.state.lock().await;
            if !state.closing {
                state.closing = true;
                state.shutdown_generation = state.shutdown_generation.wrapping_add(1);
                let (completed, completion) = watch::channel(None);
                state.completion = Some(completion);
                permit.send(PreferenceWriterMessage::Flush(completed));
            }
            Ok::<_, AppError>((state.shutdown_generation, state.completion.clone()))
        })
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)??;

        // 总期限覆盖锁、队列和实际落盘；超时只取消等待，不取消持有草稿的 writer。
        let result = tokio::time::timeout_at(deadline, async {
            if let Some(mut completion) = completion {
                loop {
                    if let Some(succeeded) = *completion.borrow_and_update() {
                        return succeeded
                            .then_some(())
                            .ok_or(AppError::FilesystemRequestFailed);
                    }
                    completion
                        .changed()
                        .await
                        .map_err(|_| AppError::FilesystemRequestFailed)?;
                }
            }
            Ok(())
        })
        .await
        .unwrap_or(Err(AppError::FilesystemRequestFailed));

        let mut state = self.state.lock().await;
        if state.shutdown_generation == generation && state.closing {
            if result.is_ok() {
                state.sender.take();
            } else if state.sender.is_some() {
                // 失败保留原 writer 和缓冲，允许用户修复磁盘或用新值覆盖无效数据。
                state.closing = false;
                state.completion = None;
            }
        } else if result.is_ok() {
            // 同一屏障的其他等待者已超时并开放写入，旧成功不能关闭新的更新。
            return Err(AppError::FilesystemRequestFailed);
        }
        result
    }
}

fn spawn_preference_writer(app_data: PathBuf) -> mpsc::Sender<PreferenceWriterMessage> {
    let (sender, receiver) = mpsc::channel(PREFERENCE_QUEUE_CAPACITY);
    tauri::async_runtime::spawn(run_preference_writer(app_data, receiver));
    sender
}

async fn run_preference_writer(
    app_data: PathBuf,
    mut receiver: mpsc::Receiver<PreferenceWriterMessage>,
) {
    let mut buffer = PreferenceWriteBuffer::default();
    let mut completions = Vec::new();
    while let Some(message) = receiver.recv().await {
        merge_message(message, &mut buffer, &mut completions);
        if completions.is_empty() {
            collect_until_deadline(
                &mut buffer,
                &mut receiver,
                &mut completions,
                PREFERENCE_WRITE_DELAY,
            )
            .await;
        }

        let mut failures = 0;
        while !buffer.is_empty() {
            let updates = buffer.take();
            if let Err(error) = app_storage::update_preferences(&app_data, updates.clone()).await {
                crate::infrastructure::diagnostics::record_error(
                    "app_preferences_persist_failed",
                    error,
                );
                buffer.restore_failed(updates);
                failures += 1;
                if failures >= PREFERENCE_MAX_WRITE_ATTEMPTS {
                    // 持续故障时停止自动写盘，草稿留在内存；新写入或显式重试再唤醒。
                    complete_flushes(&mut completions, false);
                    break;
                }
                collect_until_deadline(
                    &mut buffer,
                    &mut receiver,
                    &mut completions,
                    PREFERENCE_RETRY_DELAY,
                )
                .await;
            }
        }
        if buffer.is_empty() {
            complete_flushes(&mut completions, true);
        }
    }
}

fn merge_message(
    message: PreferenceWriterMessage,
    buffer: &mut PreferenceWriteBuffer,
    completions: &mut Vec<FlushCompletion>,
) -> bool {
    match message {
        PreferenceWriterMessage::Updates(updates) => {
            buffer.merge(updates);
            false
        }
        PreferenceWriterMessage::Flush(completion) => {
            completions.push(completion);
            true
        }
    }
}

fn complete_flushes(completions: &mut Vec<FlushCompletion>, succeeded: bool) {
    for completion in completions.drain(..) {
        let _ = completion.send(Some(succeeded));
    }
}

async fn collect_until_deadline(
    buffer: &mut PreferenceWriteBuffer,
    receiver: &mut mpsc::Receiver<PreferenceWriterMessage>,
    completions: &mut Vec<FlushCompletion>,
    delay: std::time::Duration,
) {
    let deadline = tokio::time::sleep(delay);
    tokio::pin!(deadline);
    loop {
        tokio::select! {
            () = &mut deadline => return,
            update = receiver.recv() => match update {
                Some(message) => {
                    // Flush 在所有已接受更新之后，收到即跳过合并窗口并尝试落盘。
                    if merge_message(message, buffer, completions) {
                        return;
                    }
                },
                None => return,
            },
        }
    }
}
