#[cfg(not(target_os = "macos"))]
use std::{
    sync::atomic::{AtomicU64, Ordering},
    time::Duration,
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, State, Url, WebviewWindow};
use tokio::sync::Mutex;

use super::{
    app_lifecycle::show_main_window_at_route,
    desktop_pet_window::{
        DESKTOP_PET_EVENT, DESKTOP_PET_LABEL, create_desktop_pet_window, desktop_pet_position,
        desktop_pet_size, destroy_desktop_pet_window, drag_pet_position, layout_desktop_pet_window,
        monitor_bounds, move_pet_position, persist_position, set_desktop_pet_position,
    },
    error::AppError,
    state::AppState,
    task_activity::{TaskActivitySnapshot, TaskActivityStatus},
};

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DesktopPetAnimation {
    Failed,
    Idle,
    Review,
    Running,
    Waiting,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DesktopPetDragStrategy {
    Native,
    Webview,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopPetState {
    pub(super) animation_name: DesktopPetAnimation,
    pub(super) pet_id: String,
    pub(super) tasks: Vec<DesktopPetTask>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct DesktopPetTask {
    pub(super) project_id: String,
    pub(super) root_path: Option<String>,
    pub(super) status: DesktopPetTaskStatus,
    pub(super) task_id: String,
    pub(super) task_name: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(super) enum DesktopPetTaskStatus {
    Completed,
    Running,
    Waiting,
}

#[derive(Clone, Copy, Debug, Serialize)]
pub struct DesktopPetPosition {
    x: i32,
    y: i32,
}

impl From<PhysicalPosition<i32>> for DesktopPetPosition {
    fn from(position: PhysicalPosition<i32>) -> Self {
        Self {
            x: position.x,
            y: position.y,
        }
    }
}

#[derive(Default)]
pub struct DesktopPetRuntime {
    #[cfg(not(target_os = "macos"))]
    position_generation: AtomicU64,
    pet_id: Mutex<Option<String>>,
}

impl DesktopPetRuntime {
    #[cfg(not(target_os = "macos"))]
    pub(super) fn schedule_position_persist(
        &self,
        app: AppHandle,
        position: PhysicalPosition<i32>,
    ) {
        let generation = self.position_generation.fetch_add(1, Ordering::Relaxed) + 1;
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_millis(180)).await;
            let runtime = app.state::<DesktopPetRuntime>();
            if runtime.position_generation.load(Ordering::Relaxed) == generation {
                let _ = persist_position(&app, position).await;
            }
        });
    }
}

fn ensure_desktop_pet_window(window: &WebviewWindow) -> Result<(), AppError> {
    if window.label() == DESKTOP_PET_LABEL {
        Ok(())
    } else {
        Err(AppError::DesktopPetWindowFailed)
    }
}

#[tauri::command(rename_all = "camelCase")]
pub async fn configure_desktop_pet(
    app: AppHandle,
    runtime: State<'_, DesktopPetRuntime>,
    state: State<'_, AppState>,
    pet_id: Option<String>,
) -> Result<(), AppError> {
    if pet_id
        .as_deref()
        .is_some_and(|pet_id| pet_id.is_empty() || pet_id.len() > 128)
    {
        return Err(AppError::DesktopPetWindowFailed);
    }
    *runtime.pet_id.lock().await = pet_id;
    render_desktop_pet_task_activities(&app, &state.task_activity_snapshot().await).await
}

pub(super) async fn render_desktop_pet_task_activities(
    app: &AppHandle,
    activities: &[TaskActivitySnapshot],
) -> Result<(), AppError> {
    let runtime = app.state::<DesktopPetRuntime>();
    let pet_id = runtime.pet_id.lock().await.clone();
    render_desktop_pet_state(app, desktop_pet_state(pet_id, activities)).await
}

async fn render_desktop_pet_state(
    app: &AppHandle,
    state: Option<DesktopPetState>,
) -> Result<(), AppError> {
    let Some(state) = state else {
        destroy_desktop_pet_window(app, DESKTOP_PET_LABEL).await?;
        return Ok(());
    };
    let window = match app.get_webview_window(DESKTOP_PET_LABEL) {
        Some(window) => window,
        None => create_desktop_pet_window(app).await?,
    };
    window
        .emit(DESKTOP_PET_EVENT, state)
        .map_err(|_| AppError::DesktopPetWindowFailed)
}

fn desktop_pet_state(
    pet_id: Option<String>,
    activities: &[TaskActivitySnapshot],
) -> Option<DesktopPetState> {
    let pet_id = pet_id?;
    let animation_name = if activities
        .iter()
        .any(|activity| activity.status == TaskActivityStatus::Failed)
    {
        DesktopPetAnimation::Failed
    } else if activities
        .iter()
        .any(|activity| activity.status == TaskActivityStatus::Waiting)
    {
        DesktopPetAnimation::Waiting
    } else if activities
        .iter()
        .any(|activity| activity.status == TaskActivityStatus::Running)
    {
        DesktopPetAnimation::Running
    } else if activities
        .iter()
        .any(|activity| activity.status == TaskActivityStatus::Completed)
    {
        DesktopPetAnimation::Review
    } else {
        DesktopPetAnimation::Idle
    };
    let tasks = activities
        .iter()
        .filter_map(|activity| {
            let status = match activity.status {
                TaskActivityStatus::Completed => DesktopPetTaskStatus::Completed,
                TaskActivityStatus::Running => DesktopPetTaskStatus::Running,
                TaskActivityStatus::Waiting => DesktopPetTaskStatus::Waiting,
                TaskActivityStatus::Failed => return None,
            };
            Some(DesktopPetTask {
                project_id: activity.project_id.clone(),
                root_path: activity.root_path.clone(),
                status,
                task_id: activity.task_id.clone(),
                task_name: activity.task_name.clone(),
            })
        })
        .collect();
    Some(DesktopPetState {
        animation_name,
        pet_id,
        tasks,
    })
}

#[tauri::command]
pub async fn get_desktop_pet_state(
    window: WebviewWindow,
    runtime: State<'_, DesktopPetRuntime>,
    state: State<'_, AppState>,
) -> Result<Option<DesktopPetState>, AppError> {
    ensure_desktop_pet_window(&window)?;
    Ok(desktop_pet_state(
        runtime.pet_id.lock().await.clone(),
        &state.task_activity_snapshot().await,
    ))
}

#[tauri::command]
pub fn get_desktop_pet_position(window: WebviewWindow) -> Result<DesktopPetPosition, AppError> {
    ensure_desktop_pet_window(&window)?;
    desktop_pet_position(&window).map(DesktopPetPosition::from)
}

#[tauri::command]
pub fn get_desktop_pet_drag_strategy(
    window: WebviewWindow,
) -> Result<DesktopPetDragStrategy, AppError> {
    ensure_desktop_pet_window(&window)?;
    if cfg!(target_os = "macos") {
        Ok(DesktopPetDragStrategy::Native)
    } else {
        Ok(DesktopPetDragStrategy::Webview)
    }
}

#[tauri::command]
pub fn show_desktop_pet(window: WebviewWindow) -> Result<(), AppError> {
    ensure_desktop_pet_window(&window)?;
    window.show().map_err(|_| AppError::DesktopPetWindowFailed)
}

#[tauri::command(rename_all = "camelCase")]
pub fn set_desktop_pet_drag_position(
    window: WebviewWindow,
    x: i32,
    y: i32,
) -> Result<(), AppError> {
    ensure_desktop_pet_window(&window)?;
    let size = desktop_pet_size(&window)?;
    let position = drag_pet_position(PhysicalPosition::new(x, y), &monitor_bounds(&window)?, size);
    set_desktop_pet_position(&window, position)
}

#[tauri::command]
pub async fn start_desktop_pet_native_drag(window: WebviewWindow) -> Result<(), AppError> {
    ensure_desktop_pet_window(&window)?;
    #[cfg(not(target_os = "macos"))]
    return Err(AppError::DesktopPetWindowFailed);

    #[cfg(target_os = "macos")]
    {
        super::desktop_pet_panel::run_desktop_pet_drag(&window).await?;
        let size = desktop_pet_size(&window)?;
        let current = desktop_pet_position(&window)?;
        let position = drag_pet_position(current, &monitor_bounds(&window)?, size);
        if position != current {
            set_desktop_pet_position(&window, position)?;
        }
        persist_position(window.app_handle(), position).await
    }
}

#[tauri::command(rename_all = "camelCase")]
pub async fn move_desktop_pet(
    window: WebviewWindow,
    delta_x: i32,
    delta_y: i32,
    reset: bool,
) -> Result<(), AppError> {
    ensure_desktop_pet_window(&window)?;
    if !(-48..=48).contains(&delta_x) || !(-48..=48).contains(&delta_y) {
        return Err(AppError::DesktopPetWindowFailed);
    }
    let size = desktop_pet_size(&window)?;
    let monitors = monitor_bounds(&window)?;
    let position = if reset {
        super::desktop_pet_window::resolve_pet_position(None, &monitors, size)
    } else {
        move_pet_position(
            desktop_pet_position(&window)?,
            delta_x,
            delta_y,
            &monitors,
            size,
        )
    };
    set_desktop_pet_position(&window, position)?;
    persist_position(window.app_handle(), position).await
}

#[tauri::command(rename_all = "camelCase")]
pub fn layout_desktop_pet(window: WebviewWindow, bubble_height: f64) -> Result<(), AppError> {
    ensure_desktop_pet_window(&window)?;
    layout_desktop_pet_window(&window, bubble_height)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn open_desktop_pet_task(
    window: WebviewWindow,
    project_id: String,
    task_id: String,
) -> Result<(), AppError> {
    if window.label() != DESKTOP_PET_LABEL
        || project_id.is_empty()
        || project_id.len() > 128
        || task_id.is_empty()
        || task_id.len() > 128
    {
        return Err(AppError::DesktopPetWindowFailed);
    }
    let route = desktop_pet_task_route(&project_id, &task_id)?;
    let app = window.app_handle().clone();
    show_main_window_at_route(&app, route);
    acknowledge_completed_desktop_pet_task(&app, &project_id, &task_id).await
}

pub(super) async fn acknowledge_completed_desktop_pet_task(
    app: &AppHandle,
    project_id: &str,
    task_id: &str,
) -> Result<(), AppError> {
    let state = app.state::<AppState>();
    if state.acknowledge_task_activity(project_id, task_id).await {
        render_desktop_pet_task_activities(app, &state.task_activity_snapshot().await).await?;
    }
    Ok(())
}

pub(super) async fn acknowledge_completed_desktop_pet_route(app: &AppHandle, route: &str) {
    let target = {
        app.state::<AppState>()
            .task_activity_snapshot()
            .await
            .into_iter()
            .find(|task| {
                matches!(
                    task.status,
                    TaskActivityStatus::Completed | TaskActivityStatus::Failed
                ) && desktop_pet_route_targets_task(route, &task.project_id, &task.task_id)
            })
            .map(|task| (task.project_id, task.task_id))
    };
    let Some((project_id, task_id)) = target else {
        return;
    };
    if let Err(error) = acknowledge_completed_desktop_pet_task(app, &project_id, &task_id).await {
        crate::infrastructure::diagnostics::record_error(
            "desktop_pet_task_acknowledge_failed",
            error,
        );
    }
}

pub(super) fn desktop_pet_route_targets_task(route: &str, project_id: &str, task_id: &str) -> bool {
    let route = route.split(['?', '#']).next().unwrap_or(route);
    desktop_pet_task_route(project_id, task_id).is_ok_and(|task_route| task_route == route)
}

fn desktop_pet_task_route(project_id: &str, task_id: &str) -> Result<String, AppError> {
    let mut url = Url::parse("tauri://localhost/").map_err(|_| AppError::DesktopPetWindowFailed)?;
    let mut segments = url
        .path_segments_mut()
        .map_err(|()| AppError::DesktopPetWindowFailed)?;
    if project_id == "temporary" {
        segments.push("temporary").push("t").push(task_id);
    } else {
        segments.push("p").push(project_id).push("t").push(task_id);
    }
    drop(segments);
    Ok(url.path().trim_start_matches('/').to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn desktop_pet_state_uses_the_frontend_camel_case_contract() {
        let state = DesktopPetState {
            animation_name: DesktopPetAnimation::Waiting,
            pet_id: "codex".to_string(),
            tasks: vec![DesktopPetTask {
                project_id: "project-1".to_string(),
                root_path: Some("/workspace".to_string()),
                status: DesktopPetTaskStatus::Waiting,
                task_id: "task-1".to_string(),
                task_name: "Review change".to_string(),
            }],
        };

        assert_eq!(
            serde_json::to_value(state).unwrap(),
            serde_json::json!({
                "animationName": "waiting",
                "petId": "codex",
                "tasks": [{
                    "projectId": "project-1",
                    "rootPath": "/workspace",
                    "status": "waiting",
                    "taskId": "task-1",
                    "taskName": "Review change"
                }]
            }),
        );
    }

    #[test]
    fn desktop_pet_drag_strategy_uses_the_frontend_lowercase_contract() {
        assert_eq!(
            serde_json::to_value(DesktopPetDragStrategy::Native).unwrap(),
            serde_json::json!("native"),
        );
        assert_eq!(
            serde_json::to_value(DesktopPetDragStrategy::Webview).unwrap(),
            serde_json::json!("webview"),
        );
    }

    #[test]
    fn pet_task_route_encodes_each_dynamic_segment() {
        assert_eq!(
            desktop_pet_task_route("project/one", "task two").unwrap(),
            "p/project%2Fone/t/task%20two"
        );
    }

    #[test]
    fn viewed_task_route_should_match_the_current_pet_task() {
        assert!(desktop_pet_route_targets_task(
            "p/project-1/t/task-1?panel=context#turn-1",
            "project-1",
            "task-1"
        ));
        assert!(!desktop_pet_route_targets_task(
            "p/project-1/t/task-2",
            "project-1",
            "task-1"
        ));
        assert!(desktop_pet_route_targets_task(
            "temporary/t/task-2",
            "temporary",
            "task-2"
        ));
    }
}
