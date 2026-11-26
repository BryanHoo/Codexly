use serde_json::{Value, json};
use tauri::{AppHandle, State, ipc::Channel};

use super::app_update::{
    AppUpdateInstallProgress, CHANGELOG_URL, REPOSITORY_URL, check_for_update, install_update,
};
use super::state::performance_metrics::RuntimePerformanceMetricsSnapshot;
use super::{error::AppError, state::AppState};
use crate::domain::runtime::RuntimeSnapshot;

#[tauri::command(rename_all = "camelCase")]
pub async fn connect_runtime(
    on_event: Channel,
    state: State<'_, AppState>,
) -> Result<RuntimeSnapshot, AppError> {
    Ok(state.connect(on_event).await)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn acknowledge_runtime_events(
    stream_id: u64,
    delivery_ids: Vec<u64>,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    state
        .acknowledge_runtime_events(stream_id, &delivery_ids)
        .await;
    Ok(())
}

#[tauri::command]
pub async fn get_app_info(app: AppHandle) -> Result<Value, AppError> {
    let app_version = env!("CARGO_PKG_VERSION");
    let update = check_for_update(app_version, &app).await;
    Ok(json!({
        "appVersion": app_version,
        "changelogUrl": CHANGELOG_URL,
        "codexVersion": "0.0.0",
        "claudeVersion": null,
        "latestVersion": update.latest_version,
        "releaseNotes": update.release_notes,
        "releaseNotesVersion": update.release_notes_version,
        "repositoryUrl": REPOSITORY_URL,
        "status": update.status,
        "updateAvailable": update.update_available,
    }))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn install_app_update(
    app: AppHandle,
    version: String,
    on_progress: Channel<AppUpdateInstallProgress>,
) -> Result<(), AppError> {
    install_update(&app, &version, on_progress).await
}

#[tauri::command]
pub async fn get_runtime_performance_metrics(
    state: State<'_, AppState>,
) -> Result<RuntimePerformanceMetricsSnapshot, AppError> {
    Ok(state.runtime_performance_metrics().await)
}

#[tauri::command(rename_all = "camelCase")]
pub fn cancel_native_request(request_id: String, state: State<'_, AppState>) -> Value {
    json!({ "cancelled": state.cancel_request(&request_id) })
}

#[cfg(test)]
mod tests {
    #[test]
    fn scheduled_preview_should_be_registered_and_allowed() {
        assert!(include_str!("../../build.rs").contains("\"preview_scheduled_task\""));
        assert!(include_str!("../lib.rs").contains("preview_scheduled_task,"));
        assert!(
            include_str!("../../permissions/window-command-sets.toml")
                .contains("\"allow-preview-scheduled-task\"")
        );
    }
    #[test]
    fn runtime_ack_should_be_registered() {
        assert!(include_str!("../../build.rs").contains("\"acknowledge_runtime_events\""));
        assert!(include_str!("../lib.rs").contains("acknowledge_runtime_events,"));
    }

    #[test]
    fn task_board_command_should_be_registered_and_allowed() {
        let build_manifest = include_str!("../../build.rs");
        let permissions = include_str!("../../permissions/window-command-sets.toml");

        assert!(
            build_manifest.contains("\"list_completed_tasks\""),
            "Tauri app manifest must register list_completed_tasks"
        );
        assert!(
            permissions.contains("\"allow-list-completed-tasks\""),
            "main-window-commands must allow list_completed_tasks"
        );
    }

    #[test]
    fn scheduled_task_commands_should_be_registered_and_allowed() {
        let build_manifest = include_str!("../../build.rs");
        let permissions = include_str!("../../permissions/window-command-sets.toml");

        for command in [
            "list_scheduled_tasks",
            "create_scheduled_task",
            "update_scheduled_task",
            "delete_scheduled_task",
            "set_scheduled_task_enabled",
            "run_scheduled_task_now",
        ] {
            assert!(
                build_manifest.contains(&format!("\"{command}\"")),
                "Tauri app manifest must register {command}"
            );
            let permission = format!("allow-{}", command.replace('_', "-"));
            assert!(
                permissions.contains(&format!("\"{permission}\"")),
                "main-window-commands must include {permission}"
            );
        }
    }
}
