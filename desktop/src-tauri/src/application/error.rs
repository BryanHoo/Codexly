use serde::{Serialize, ser::SerializeStruct, ser::Serializer};
use thiserror::Error;

use crate::infrastructure::{
    codex::ConnectionError, skills_market::SkillsMarketError, workspace::WorkspaceError,
};

#[derive(Debug, Error)]
pub enum AppError {
    #[error("pending request is unavailable or its identity has changed")]
    PendingRequestUnavailable,
    #[error(transparent)]
    GoalInput(#[from] crate::domain::goal_input::GoalInputError),
    #[error("queue recovery capacity is exhausted; retry later")]
    QueueRecoveryCapacityExceeded,
    #[error("the task queue is empty")]
    QueueEmpty,
    #[error("queued prompt acceptance is unconfirmed; inspect the task before retrying")]
    QueueRecoveryUncertain,
    #[error("queued content differs from the accepted prompt; inspect it before cleanup")]
    QueuedContentChanged,
    #[error("global instructions changed; reload before saving")]
    GlobalInstructionsChanged,
    #[error("task window operation failed")]
    TaskWindowFailed,
    #[error("at most three task windows can be open")]
    TaskWindowLimit,
    #[error(transparent)]
    Terminal(#[from] crate::domain::project_terminal::TerminalError),
    #[error("failed to start Codex runtime")]
    CodexRuntimeStartFailed,
    #[error("failed to install Codex runtime")]
    CodexRuntimeInstallFailed,
    #[error("failed to check for a Codexly update")]
    AppUpdateCheckFailed,
    #[error("the selected Codexly update is no longer available")]
    AppUpdateUnavailable,
    #[error("failed to install the Codexly update")]
    AppUpdateInstallFailed,
    #[error("Codex runtime is unavailable")]
    CodexRuntimeUnavailable,
    #[error("Codex request failed")]
    CodexRequestFailed,
    #[error("{message}")]
    CodexRpc { rpc_code: i64, message: String },
    #[error("Codex thread is active in another session")]
    CodexThreadBusy,
    #[error("native request was cancelled")]
    RequestCancelled,
    #[error("filesystem request failed")]
    FilesystemRequestFailed,
    #[error("file does not exist or cannot be accessed")]
    FileOpenTargetUnavailable,
    #[error("system default application could not open the file")]
    FileOpenApplicationFailed,
    #[error("scheduled task input is invalid")]
    ScheduledTaskInvalid,
    #[error("scheduled task was not found")]
    ScheduledTaskNotFound,
    #[error("scheduled task is already starting")]
    ScheduledTaskBusy,
    #[error(transparent)]
    Workspace(#[from] WorkspaceError),
    #[error(transparent)]
    SkillsMarket(#[from] SkillsMarketError),
    #[error("failed to resolve user home directory")]
    HomeDirectoryUnavailable,
    #[error("workbench pet asset is unavailable")]
    PetAssetUnavailable,
    #[error("desktop pet window operation failed")]
    DesktopPetWindowFailed,
    #[error("project file window operation failed")]
    ProjectFileWindowFailed,
    #[error("workbench background is unavailable")]
    WorkbenchBackgroundUnavailable,
    #[error("tray operation failed")]
    TrayOperationFailed,
    #[error("failed to export diagnostics")]
    DiagnosticsExportFailed,
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        if let Self::CodexRpc { rpc_code, message } = self {
            let mut payload = serializer.serialize_struct("AppError", 3)?;
            payload.serialize_field("code", "CODEX_RPC_ERROR")?;
            payload.serialize_field("message", message)?;
            payload.serialize_field("rpcCode", rpc_code)?;
            return payload.end();
        }
        let structured_error = match self {
            Self::PendingRequestUnavailable => {
                Some(("PENDING_REQUEST_UNAVAILABLE", self.to_string()))
            }
            Self::GoalInput(error) => Some((error.code(), error.to_string())),
            Self::QueueRecoveryCapacityExceeded => {
                Some(("IDEMPOTENCY_CAPACITY_EXCEEDED", self.to_string()))
            }
            Self::QueueEmpty => Some(("QUEUE_EMPTY", self.to_string())),
            Self::QueueRecoveryUncertain => Some(("TURN_START_UNCERTAIN", self.to_string())),
            Self::QueuedContentChanged => Some(("IDEMPOTENCY_CONFLICT", self.to_string())),
            Self::GlobalInstructionsChanged => {
                Some(("GLOBAL_INSTRUCTIONS_CHANGED", self.to_string()))
            }
            Self::TaskWindowLimit => Some(("TASK_WINDOW_LIMIT", self.to_string())),
            Self::Terminal(error) => Some((error.code(), error.to_string())),
            Self::CodexThreadBusy => Some(("CODEX_THREAD_BUSY", self.to_string())),
            Self::RequestCancelled => Some(("REQUEST_CANCELLED", self.to_string())),
            Self::FileOpenTargetUnavailable => {
                Some(("FILE_OPEN_TARGET_UNAVAILABLE", self.to_string()))
            }
            Self::FileOpenApplicationFailed => {
                Some(("FILE_OPEN_APPLICATION_FAILED", self.to_string()))
            }
            Self::ScheduledTaskInvalid => Some(("SCHEDULED_TASK_INVALID", self.to_string())),
            Self::ScheduledTaskNotFound => Some(("SCHEDULED_TASK_NOT_FOUND", self.to_string())),
            Self::ScheduledTaskBusy => Some(("SCHEDULED_TASK_BUSY", self.to_string())),
            Self::Workspace(error) => Some((error.code(), error.to_string())),
            Self::SkillsMarket(error) => Some((error.code(), error.to_string())),
            _ => None,
        };
        if let Some((code, message)) = structured_error {
            let mut payload = serializer.serialize_struct("AppError", 2)?;
            payload.serialize_field("code", code)?;
            payload.serialize_field("message", &message)?;
            return payload.end();
        }
        serializer.serialize_str(&self.to_string())
    }
}

impl From<ConnectionError> for AppError {
    fn from(error: ConnectionError) -> Self {
        // active writer 保持稳定业务码，其余 RPC 错误保留 Codex 返回的诊断信息。
        match error {
            ConnectionError::Request {
                code: -32600,
                message,
            } if message.starts_with("thread ")
                && message.ends_with(" already has an active writer") =>
            {
                Self::CodexThreadBusy
            }
            ConnectionError::Request { code, message } => Self::CodexRpc {
                rpc_code: code,
                message,
            },
            _ => Self::CodexRequestFailed,
        }
    }
}

impl From<crate::infrastructure::codex::AgentSettingsError> for AppError {
    fn from(error: crate::infrastructure::codex::AgentSettingsError) -> Self {
        match error {
            crate::infrastructure::codex::AgentSettingsError::Connection(error) => error.into(),
            crate::infrastructure::codex::AgentSettingsError::Local(_) => {
                Self::FilesystemRequestFailed
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn terminal_errors_preserve_stable_native_codes() {
        let error = AppError::from(crate::domain::project_terminal::TerminalError::ScopeMismatch);
        assert_eq!(
            serde_json::to_value(error).unwrap()["code"],
            "TERMINAL_SCOPE_MISMATCH"
        );
    }

    #[test]
    fn workspace_error_should_preserve_code_and_message() {
        let value = serde_json::to_value(AppError::from(WorkspaceError::SnapshotMismatch)).unwrap();

        assert_eq!(
            value,
            json!({
                "code": "SNAPSHOT_MISMATCH",
                "message": "workspace snapshot changed; refresh and retry"
            })
        );
    }

    #[test]
    fn missing_git_should_preserve_recoverable_error_details() {
        let value = serde_json::to_value(AppError::from(WorkspaceError::GitNotFound)).unwrap();

        assert_eq!(
            value,
            json!({
                "code": "GIT_NOT_FOUND",
                "message": "Git was not found; install Git and restart Codexly"
            })
        );
    }

    #[test]
    fn oversized_git_metadata_should_preserve_limit_and_stable_code() {
        let value = serde_json::to_value(AppError::from(WorkspaceError::GitOutputTooLarge {
            operation: "references",
            maximum_bytes: 2_097_152,
        }))
        .unwrap();

        assert_eq!(
            value,
            json!({
                "code": "GIT_OUTPUT_TOO_LARGE",
                "message": "git references output exceeded 2097152 bytes"
            })
        );
    }

    #[test]
    fn active_thread_writer_should_preserve_a_stable_error_code() {
        let error = crate::infrastructure::codex::ConnectionError::Request {
            code: -32600,
            message: "thread thread-a already has an active writer".to_owned(),
        };

        assert_eq!(
            serde_json::to_value(AppError::from(error)).unwrap(),
            json!({
                "code": "CODEX_THREAD_BUSY",
                "message": "Codex thread is active in another session"
            })
        );
    }

    #[test]
    fn codex_rpc_errors_should_preserve_code_and_message() {
        let error = crate::infrastructure::codex::ConnectionError::Request {
            code: -32600,
            message: "invalid turn options".to_owned(),
        };

        assert_eq!(
            serde_json::to_value(AppError::from(error)).unwrap(),
            json!({
                "code": "CODEX_RPC_ERROR",
                "message": "invalid turn options",
                "rpcCode": -32600
            })
        );
    }
}
