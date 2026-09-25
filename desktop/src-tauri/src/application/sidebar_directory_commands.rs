use tauri::{AppHandle, Manager, State};

use super::{error::AppError, state::AppState};
use crate::{
    domain::sidebar::ProjectDirectoryListing,
    infrastructure::filesystem::list_project_directories as read_project_directories,
};

#[tauri::command(rename_all = "camelCase")]
pub async fn list_project_directories(
    app: AppHandle,
    path: Option<String>,
    include_hidden: bool,
    request_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<ProjectDirectoryListing, AppError> {
    state
        .run_cancellable(request_id.as_deref(), async {
            let home = app
                .path()
                .home_dir()
                .map_err(|_| AppError::HomeDirectoryUnavailable)?;
            read_project_directories(&home, path.as_deref(), include_hidden)
                .await
                .map_err(|_| AppError::FilesystemRequestFailed)
        })
        .await
}
