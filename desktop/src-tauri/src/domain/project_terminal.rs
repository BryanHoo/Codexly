use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::str::FromStr;

pub const BLOCK_BYTES: usize = 16 * 1024;
pub const OUTPUT_HIGH_BYTES: u64 = 256 * 1024;
pub const OUTPUT_LOW_BYTES: u64 = 64 * 1024;
pub const INPUT_QUEUE_BYTES: usize = 64 * 1024;
pub const PROJECT_SESSIONS: usize = 4;
pub const GLOBAL_SESSIONS: usize = 12;
pub const MAX_COLS: u16 = 500;
pub const MAX_ROWS: u16 = 200;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord)]
pub struct DecimalU64(pub u64);

impl Serialize for DecimalU64 {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.0.to_string())
    }
}
impl<'de> Deserialize<'de> for DecimalU64 {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        String::deserialize(deserializer)?
            .parse()
            .map_err(serde::de::Error::custom)
    }
}
impl FromStr for DecimalU64 {
    type Err = TerminalError;
    fn from_str(value: &str) -> Result<Self, Self::Err> {
        if value.is_empty()
            || value.len() > 20
            || (value.len() > 1 && value.starts_with('0'))
            || !value.bytes().all(|b| b.is_ascii_digit())
        {
            return Err(TerminalError::StreamInvalid);
        }
        value
            .parse()
            .map(Self)
            .map_err(|_| TerminalError::StreamInvalid)
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TerminalScope {
    pub project_id: String,
    pub terminal_id: String,
    pub generation: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TerminalState {
    Running,
    Closing,
    Exited,
    Failed,
}
impl TerminalState {
    pub fn is_live(self) -> bool {
        matches!(self, Self::Running | Self::Closing)
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalMetadata {
    #[serde(flatten)]
    pub scope: TerminalScope,
    pub root_id: String,
    pub title: String,
    pub state: TerminalState,
    pub cols: u16,
    pub rows: u16,
    pub exit_code: Option<u32>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "type",
    content = "data"
)]
pub enum TerminalEvent {
    Created(TerminalMetadata),
    StateChanged(TerminalMetadata),
    Exited {
        #[serde(flatten)]
        metadata: TerminalMetadata,
        final_offset: DecimalU64,
        truncated_reason: Option<String>,
    },
    Removed(TerminalScope),
}
#[derive(Clone, Debug, Serialize)]
pub struct TerminalControlEvent {
    pub sequence: DecimalU64,
    #[serde(flatten)]
    pub event: TerminalEvent,
}
#[derive(Clone, Debug, Serialize)]
pub struct TerminalSnapshot {
    pub generation: String,
    pub sequence: DecimalU64,
    pub terminals: Vec<TerminalMetadata>,
}
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateTerminalRequest {
    pub project_id: String,
    pub root_id: String,
    pub request_id: String,
    pub generation: String,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, thiserror::Error)]
pub enum TerminalError {
    #[error("terminal project was not found")]
    ProjectNotFound,
    #[error("terminal root is invalid")]
    RootInvalid,
    #[error("terminal session limit reached")]
    LimitReached,
    #[error("terminal was not found")]
    NotFound,
    #[error("terminal scope does not match its owner")]
    ScopeMismatch,
    #[error("terminal owner is closing")]
    OwnerClosing,
    #[error("failed to spawn terminal shell")]
    SpawnFailed,
    #[error("terminal input exceeds its byte limit")]
    InputTooLarge,
    #[error("terminal stream is invalid")]
    StreamInvalid,
    #[error("terminal cleanup did not complete")]
    CleanupFailed,
    #[error("terminal input sequence has a gap")]
    InputSequenceGap,
    #[error("terminal input queue is full")]
    InputQueueFull,
    #[error("terminal request conflicts with an existing channel")]
    RequestConflict,
}
impl TerminalError {
    pub fn code(self) -> &'static str {
        match self {
            Self::ProjectNotFound => "TERMINAL_PROJECT_NOT_FOUND",
            Self::RootInvalid => "TERMINAL_ROOT_INVALID",
            Self::LimitReached => "TERMINAL_LIMIT_REACHED",
            Self::NotFound => "TERMINAL_NOT_FOUND",
            Self::ScopeMismatch => "TERMINAL_SCOPE_MISMATCH",
            Self::OwnerClosing => "TERMINAL_OWNER_CLOSING",
            Self::SpawnFailed => "TERMINAL_SPAWN_FAILED",
            Self::InputTooLarge => "TERMINAL_INPUT_TOO_LARGE",
            Self::StreamInvalid => "TERMINAL_STREAM_INVALID",
            Self::CleanupFailed => "TERMINAL_CLEANUP_FAILED",
            Self::InputSequenceGap => "TERMINAL_INPUT_SEQUENCE_GAP",
            Self::InputQueueFull => "TERMINAL_INPUT_QUEUE_FULL",
            Self::RequestConflict => "TERMINAL_REQUEST_CONFLICT",
        }
    }
}

pub fn validate_size(cols: u16, rows: u16) -> Result<(), TerminalError> {
    if (1..=MAX_COLS).contains(&cols) && (1..=MAX_ROWS).contains(&rows) {
        Ok(())
    } else {
        Err(TerminalError::StreamInvalid)
    }
}

pub fn validate_id(value: &str) -> Result<(), TerminalError> {
    if value.is_empty()
        || value.encode_utf16().count() > 256
        || value.chars().any(|c| c <= '\u{1f}' || c == '\u{7f}')
    {
        return Err(TerminalError::ScopeMismatch);
    }
    Ok(())
}

pub fn decode_scope_id(value: &str) -> Result<String, TerminalError> {
    // header 只解码一次，保留 ID 中原本存在的百分号，禁止歧义解码和控制字符。
    if value.len() > 3072 {
        return Err(TerminalError::ScopeMismatch);
    }
    let mut decoded = Vec::with_capacity(value.len());
    let mut bytes = value.bytes();
    while let Some(byte) = bytes.next() {
        if byte == b'%' {
            let high = bytes.next().and_then(|b| (b as char).to_digit(16));
            let low = bytes.next().and_then(|b| (b as char).to_digit(16));
            let (Some(high), Some(low)) = (high, low) else {
                return Err(TerminalError::ScopeMismatch);
            };
            decoded.push((high * 16 + low) as u8);
        } else if byte.is_ascii() {
            decoded.push(byte);
        } else {
            return Err(TerminalError::ScopeMismatch);
        }
    }
    let decoded = String::from_utf8(decoded).map_err(|_| TerminalError::ScopeMismatch)?;
    validate_id(&decoded)?;
    Ok(decoded)
}

pub fn encode_frame(
    sequence: u64,
    end_offset: u64,
    bytes: &[u8],
) -> Result<Vec<u8>, TerminalError> {
    if sequence == 0
        || bytes.is_empty()
        || bytes.len() > BLOCK_BYTES
        || end_offset < bytes.len() as u64
    {
        return Err(TerminalError::StreamInvalid);
    }
    let mut frame = Vec::with_capacity(16 + bytes.len());
    frame.extend_from_slice(&sequence.to_le_bytes());
    frame.extend_from_slice(&end_offset.to_le_bytes());
    frame.extend_from_slice(bytes);
    Ok(frame)
}
