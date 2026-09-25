use std::{collections::BTreeMap, path::PathBuf};

use tokio::sync::{Mutex, mpsc, watch};

use super::error::AppError;
use crate::infrastructure::app_storage;

const PREFERENCE_QUEUE_CAPACITY: usize = 64;
const PREFERENCE_WRITE_DELAY: std::time::Duration = std::time::Duration::from_millis(100);
const PREFERENCE_RETRY_DELAY: std::time::Duration = std::time::Duration::from_secs(1);

type PreferenceUpdates = BTreeMap<String, Option<String>>;

#[derive(Default)]
pub(crate) struct AppStorageRuntime {
    state: Mutex<StorageWriterState>,
}

#[derive(Default)]
struct StorageWriterState {
    closing: bool,
    sender: Option<mpsc::Sender<PreferenceUpdates>>,
    completion: Option<watch::Receiver<bool>>,
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
        // 入队和关闭共享同一把锁，确保屏障不会越过已经接受的写入。
        let mut state = self.state.lock().await;
        if state.closing {
            return Err(AppError::FilesystemRequestFailed);
        }
        if state.sender.is_none() {
            let (sender, completion) = spawn_preference_writer(app_data);
            state.sender = Some(sender);
            state.completion = Some(completion);
        }
        // writer 异常退出时拒绝新写入，不能重建并掩盖已接收数据的丢失。
        state
            .sender
            .as_ref()
            .ok_or(AppError::FilesystemRequestFailed)?
            .send(updates)
            .await
            .map_err(|_| AppError::FilesystemRequestFailed)
    }

    pub(crate) async fn shutdown(&self) -> Result<(), AppError> {
        let completion = {
            let mut state = self.state.lock().await;
            state.closing = true;
            // 丢弃唯一发送端：writer 排空队列后才发布完成信号。
            state.sender.take();
            state.completion.clone()
        };
        if let Some(mut completion) = completion {
            while !*completion.borrow_and_update() {
                completion
                    .changed()
                    .await
                    .map_err(|_| AppError::FilesystemRequestFailed)?;
            }
        }
        Ok(())
    }
}

fn spawn_preference_writer(
    app_data: PathBuf,
) -> (mpsc::Sender<PreferenceUpdates>, watch::Receiver<bool>) {
    let (sender, receiver) = mpsc::channel(PREFERENCE_QUEUE_CAPACITY);
    let (completed, completion) = watch::channel(false);
    tauri::async_runtime::spawn(async move {
        run_preference_writer(app_data, receiver).await;
        let _ = completed.send(true);
    });
    (sender, completion)
}

async fn run_preference_writer(app_data: PathBuf, mut receiver: mpsc::Receiver<PreferenceUpdates>) {
    let mut buffer = PreferenceWriteBuffer::default();
    while let Some(updates) = receiver.recv().await {
        buffer.merge(updates);
        collect_until_deadline(&mut buffer, &mut receiver, PREFERENCE_WRITE_DELAY, false).await;

        while !buffer.is_empty() {
            let updates = buffer.take();
            if let Err(error) = app_storage::update_preferences(&app_data, updates.clone()).await {
                crate::infrastructure::diagnostics::record_error(
                    "app_preferences_persist_failed",
                    error,
                );
                buffer.restore_failed(updates);
                collect_until_deadline(&mut buffer, &mut receiver, PREFERENCE_RETRY_DELAY, true)
                    .await;
                continue;
            }
        }
    }
}

async fn collect_until_deadline(
    buffer: &mut PreferenceWriteBuffer,
    receiver: &mut mpsc::Receiver<PreferenceUpdates>,
    delay: std::time::Duration,
    retrying: bool,
) {
    let deadline = tokio::time::sleep(delay);
    tokio::pin!(deadline);
    loop {
        tokio::select! {
            () = &mut deadline => return,
            update = receiver.recv() => match update {
                Some(update) => buffer.merge(update),
                None => {
                    // 关闭时跳过合并窗口，但失败重试仍须退避，避免持续写盘失败造成忙循环。
                    if retrying {
                        deadline.await;
                    }
                    return;
                },
            },
        }
    }
}
