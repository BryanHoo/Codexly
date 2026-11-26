use serde::{Serialize, ser::SerializeStruct, ser::Serializer};
use thiserror::Error;

use crate::infrastructure::workspace::WorkspaceError;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("ACP host is unavailable")]
    AcpHostUnavailable,
    #[error("ACP submission outcome is unknown; inspect the task before sending again")]
    AcpSubmissionUnknown,
    #[error("ACP submission key belongs to a different request")]
    AcpSubmissionConflict,
    #[error("Scheduled task configuration changed; reload before saving")]
    ScheduledTaskConfigConflict,
    #[error("{0}")]
    Claude(String),
    #[error("{0}")]
    Acp(String),
    #[error(transparent)]
    LocalCatalog(#[from] crate::infrastructure::local_catalog::CatalogError),
    #[error("failed to enable login startup")]
    AutostartFailed,
    #[error(transparent)]
    GoalInput(#[from] crate::domain::goal_input::GoalInputError),
    #[error("queue recovery capacity is exhausted; retry later")]
    QueueRecoveryCapacityExceeded,
    #[error(transparent)]
    Terminal(#[from] crate::domain::project_terminal::TerminalError),
    #[error("failed to check for a Codexly update")]
    AppUpdateCheckFailed,
    #[error("the selected Codexly update is no longer available")]
    AppUpdateUnavailable,
    #[error("failed to install the Codexly update")]
    AppUpdateInstallFailed,
    #[error("Codex request failed")]
    CodexRequestFailed,
    #[error("native request was cancelled")]
    RequestCancelled,
    #[error("filesystem request failed")]
    FilesystemRequestFailed,
    #[error("A file or directory with that name already exists")]
    ProjectFileConflict,
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
        let structured_error = match self {
            Self::AcpSubmissionUnknown => Some(("SUBMISSION_OUTCOME_UNKNOWN", self.to_string())),
            Self::AcpSubmissionConflict => Some(("IDEMPOTENCY_CONFLICT", self.to_string())),
            Self::ScheduledTaskConfigConflict => Some(("IDEMPOTENCY_CONFLICT", self.to_string())),
            Self::Acp(message) => Some(("ACP_REQUEST_FAILED", message.clone())),
            Self::Claude(message) => Some(("CLAUDE_ERROR", message.clone())),
            Self::GoalInput(error) => Some((error.code(), error.to_string())),
            Self::QueueRecoveryCapacityExceeded => {
                Some(("IDEMPOTENCY_CAPACITY_EXCEEDED", self.to_string()))
            }
            Self::Terminal(error) => Some((error.code(), error.to_string())),
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
            Self::ProjectFileConflict => Some(("PROJECT_FILE_CONFLICT", self.to_string())),
            Self::Workspace(error) => Some((error.code(), error.to_string())),
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
}
