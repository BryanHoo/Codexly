use std::sync::atomic::{AtomicU64, Ordering};

use tauri::{AppHandle, Url, WebviewUrl, WebviewWindowBuilder};

use super::error::AppError;

const MAX_PROJECT_FILE_ROUTE_BYTES: usize = 16 * 1024;
static PROJECT_FILE_WINDOW_SEQUENCE: AtomicU64 = AtomicU64::new(1);

fn is_valid_project_file_route(route: &str) -> bool {
    if route.is_empty() || route.len() > MAX_PROJECT_FILE_ROUTE_BYTES || route.contains(['\0', '#'])
    {
        return false;
    }
    let Ok(url) = Url::parse(&format!("tauri://localhost/{route}")) else {
        return false;
    };
    let segments = url.path_segments().map(Iterator::collect::<Vec<_>>);
    if !matches!(segments.as_deref(), Some(["p", project_id, "file"]) if !project_id.is_empty()) {
        return false;
    }
    let mut has_path = false;
    let mut has_preview_kind = false;
    let mut has_window_surface = false;
    for (key, value) in url.query_pairs() {
        match key.as_ref() {
            "path" => has_path = !value.is_empty(),
            "previewKind" => has_preview_kind = matches!(value.as_ref(), "image" | "source"),
            "window" => has_window_surface = value == "project-file",
            _ => {}
        }
    }
    has_path && has_preview_kind && has_window_surface
}

#[tauri::command]
pub fn open_project_file_window(app: AppHandle, route: String) -> Result<(), AppError> {
    if !is_valid_project_file_route(&route) {
        return Err(AppError::ProjectFileWindowFailed);
    }
    let sequence = PROJECT_FILE_WINDOW_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    WebviewWindowBuilder::new(
        &app,
        format!("project-file-{sequence}"),
        WebviewUrl::App(route.into()),
    )
    .title("Codexly")
    .inner_size(1100.0, 800.0)
    .resizable(true)
    .center()
    .build()
    .map_err(|_| AppError::ProjectFileWindowFailed)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::is_valid_project_file_route;

    #[test]
    fn project_file_window_only_accepts_internal_preview_routes() {
        assert!(is_valid_project_file_route(
            "p/project-a/file?path=src%2Fmain.ts&previewKind=source&window=project-file"
        ));
        assert!(!is_valid_project_file_route("https://example.com"));
        assert!(!is_valid_project_file_route(
            "p/project-a/file?path=src%2Fmain.ts&previewKind=source"
        ));
    }
}
