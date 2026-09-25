use super::{StoredResult, TurnStartResult, error};
use crate::domain::conversation::{AgentPromptInput, AgentTurnOptions};
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::io::{self, Write};

const MAX_REQUEST_BYTES: usize = 4 * 1024 * 1024;
const MAX_RESULT_BYTES: usize = 64 * 1024;
const UNCERTAIN_RESULT: &[u8] = br#"{"Err":{"code":"TURN_START_UNCERTAIN","message":"Turn start result is unavailable; refresh the task before starting a new attempt"}}"#;

pub struct TurnStartIdentity {
    pub(super) digest: [u8; 32],
    pub(super) bytes: usize,
}

impl TurnStartIdentity {
    pub(crate) fn digest(&self) -> [u8; 32] {
        self.digest
    }

    pub(crate) fn encoded_bytes(&self) -> usize {
        self.bytes
    }
}

pub fn fingerprint(
    project_id: &str,
    task_id: &str,
    input: &AgentPromptInput,
    options: &AgentTurnOptions,
) -> Result<TurnStartIdentity, Value> {
    // 提交创建前和直接启动共用校验，不能等到 Goal RPC 前才发现无效输入。
    crate::domain::goal_input::validate_turn_input(input, options)
        .map_err(|error| serde_json::json!(super::super::error::AppError::from(error)))?;
    fingerprint_payload(project_id, task_id, &(project_id, task_id, input, options))
}

pub fn fingerprint_review(
    project_id: &str,
    task_id: &str,
    target: &Value,
) -> Result<TurnStartIdentity, Value> {
    fingerprint_payload(
        project_id,
        task_id,
        &(project_id, task_id, "review", target),
    )
}

pub fn fingerprint_pending_resolution(
    project_id: &str,
    task_id: &str,
    reference: &impl Serialize,
    resolution: &Value,
) -> Result<TurnStartIdentity, Value> {
    fingerprint_payload(
        project_id,
        task_id,
        &(
            project_id,
            task_id,
            "pending-resolution",
            reference,
            resolution,
        ),
    )
}

fn fingerprint_payload(
    project_id: &str,
    task_id: &str,
    payload: &impl Serialize,
) -> Result<TurnStartIdentity, Value> {
    if [project_id, task_id]
        .iter()
        .any(|id| id.is_empty() || id.len() > 1024)
    {
        return Err(error(
            "INVALID_REQUEST",
            "Turn start requires bounded project and task identities",
        ));
    }
    let mut writer = LimitedWriter {
        inner: HashWriter(Sha256::new()),
        bytes: 0,
        limit: MAX_REQUEST_BYTES,
    };
    // 对原生反序列化后的完整输入流式取摘要；不创建或保留第二份提示词正文。
    serde_json::to_writer(&mut writer, payload).map_err(|_| {
        error(
            "INVALID_REQUEST",
            "Turn start request exceeds the encoding budget",
        )
    })?;
    Ok(TurnStartIdentity {
        digest: writer.inner.0.finalize().into(),
        bytes: writer.bytes,
    })
}

pub fn fingerprint_queue_start(
    project_id: &str,
    task_id: &str,
    submission_id: Option<&str>,
) -> Result<TurnStartIdentity, Value> {
    if submission_id.is_some_and(|id| id.is_empty() || id.len() > 1024) {
        return Err(error(
            "INVALID_REQUEST",
            "Queue start requires a bounded submission identity",
        ));
    }
    fingerprint_payload(
        project_id,
        task_id,
        &(project_id, task_id, "queue-start", submission_id),
    )
}

pub fn fingerprint_steer(
    project_id: &str,
    task_id: &str,
    turn_id: &str,
    input: &AgentPromptInput,
) -> Result<TurnStartIdentity, Value> {
    if turn_id.is_empty() || turn_id.len() > 1024 {
        return Err(error(
            "INVALID_REQUEST",
            "Steer requires a bounded target turn identity",
        ));
    }
    // 目标 Turn 是身份的一部分；同一任务的新回合不能复用旧追加请求。
    fingerprint_payload(
        project_id,
        task_id,
        &(project_id, task_id, "steer", turn_id, input),
    )
}

pub fn fingerprint_queued_steer(
    project_id: &str,
    task_id: &str,
    turn_id: &str,
    submission_id: &str,
    input: &AgentPromptInput,
) -> Result<TurnStartIdentity, Value> {
    if [turn_id, submission_id]
        .iter()
        .any(|id| id.is_empty() || id.len() > 1024)
    {
        return Err(error(
            "INVALID_REQUEST",
            "Queued steer requires bounded turn and submission identities",
        ));
    }
    fingerprint_payload(
        project_id,
        task_id,
        &(
            project_id,
            task_id,
            "queued-steer",
            turn_id,
            submission_id,
            input,
        ),
    )
}

pub fn fingerprint_queue_content(
    project_id: &str,
    task_id: &str,
    submission_id: &str,
    input: &AgentPromptInput,
) -> Result<TurnStartIdentity, Value> {
    fingerprint_payload(
        project_id,
        task_id,
        &(project_id, task_id, submission_id, input),
    )
}

pub(super) fn encode_result(result: &TurnStartResult) -> StoredResult {
    let mut writer = LimitedWriter {
        inner: Vec::new(),
        bytes: 0,
        limit: MAX_RESULT_BYTES,
    };
    // 超限立即停止编码并保留不确定记录，不能释放幂等键后重复执行副作用。
    if serde_json::to_writer(&mut writer, result).is_err() {
        return UNCERTAIN_RESULT.into();
    }
    writer.inner.into()
}

struct LimitedWriter<W> {
    inner: W,
    bytes: usize,
    limit: usize,
}

impl<W: Write> Write for LimitedWriter<W> {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if bytes.len() > self.limit.saturating_sub(self.bytes) {
            return Err(io::Error::other("encoding budget exceeded"));
        }
        self.inner.write_all(bytes)?;
        self.bytes += bytes.len();
        Ok(bytes.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        self.inner.flush()
    }
}

struct HashWriter(Sha256);

impl Write for HashWriter {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        self.0.update(bytes);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

#[cfg(test)]
#[path = "turn_start_payload_tests.rs"]
mod tests;
