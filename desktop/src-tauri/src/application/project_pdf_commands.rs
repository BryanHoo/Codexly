use std::path::Path;

use tauri::{AppHandle, Manager, State};
use tokio::io::AsyncReadExt;

use super::{error::AppError, state::AppState, task_workspace};
use crate::infrastructure::workspace;

#[tauri::command(rename_all = "camelCase")]
pub async fn get_project_pdf_file(
    app: AppHandle,
    project_id: String,
    root_path: Option<String>,
    task_id: Option<String>,
    path: String,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let root = task_workspace::resolve_preview_root(
        &state,
        &project_id,
        task_id.as_deref(),
        root_path.as_deref(),
        &path,
    )
    .await?;
    let relative = task_workspace::relative_preview_path(&root, &path)?;
    let file_path = workspace::resolve_existing(&root, Some(&relative))
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    validate_pdf(&file_path).await?;
    // 只授权经过校验的单个文件，避免扩大到项目目录；PDF 正文不经过 IPC。
    app.asset_protocol_scope()
        .allow_file(&file_path)
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    file_path
        .into_os_string()
        .into_string()
        .map_err(|_| AppError::FilesystemRequestFailed)
}

async fn validate_pdf(path: &Path) -> Result<(), AppError> {
    let mut file = tokio::fs::File::open(path)
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    let mut signature = [0_u8; 5];
    file.read_exact(&mut signature)
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    if &signature != b"%PDF-"
        || !file
            .metadata()
            .await
            .map_err(|_| AppError::FilesystemRequestFailed)?
            .is_file()
    {
        return Err(AppError::FilesystemRequestFailed);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::validate_pdf;

    #[tokio::test]
    async fn pdf_validation_should_reject_disguised_and_truncated_files() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("报告.PDF");
        for content in [b"<html>not PDF</html>".as_slice(), b"%PDF".as_slice()] {
            tokio::fs::write(&path, content).await.unwrap();
            assert!(validate_pdf(&path).await.is_err());
        }
    }

    #[tokio::test]
    async fn pdf_validation_should_accept_pdf_signature() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("report.pdf");
        tokio::fs::write(&path, b"%PDF-1.7\n%%EOF").await.unwrap();
        assert!(validate_pdf(&path).await.is_ok());
    }
}
