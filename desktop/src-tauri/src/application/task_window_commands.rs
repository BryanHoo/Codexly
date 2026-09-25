use tauri::{
    AppHandle, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder, ipc::Channel,
};

use super::{
    error::AppError,
    state::AppState,
    task_window_stream::{TaskWindowPacket, TaskWindowProjection},
};

#[tauri::command(rename_all = "camelCase")]
pub async fn open_task_window(
    app: AppHandle,
    window: WebviewWindow,
    project_id: String,
    task_id: String,
    theme: String,
    language: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    if window.label() != "main" {
        return Err(AppError::TaskWindowFailed);
    }
    let runtime = state.task_windows().await;
    let (label, created) = runtime.reserve(&project_id, &task_id)?;
    if !created {
        if let Some(existing) = app.get_webview_window(&label) {
            existing.show().map_err(|_| AppError::TaskWindowFailed)?;
        }
        return Ok(());
    }
    let theme = match theme.as_str() {
        "dark" => "dark",
        "light" => "light",
        _ => "system",
    };
    let language = if language == "en" { "en" } else { "zh-CN" };
    let route = format!("index.html?window=task-window&theme={theme}&language={language}");
    let result = create_task_window(&app, &label, &project_id, &task_id, route, &state).await;
    if result.is_err() {
        let _ = super::desktop_pet_window::destroy_desktop_pet_window(&app, &label).await;
        release_window(&app, &label).await;
    }
    result
}

async fn create_task_window(
    app: &AppHandle,
    label: &str,
    project_id: &str,
    task_id: &str,
    route: String,
    state: &AppState,
) -> Result<(), AppError> {
    let connection = state.codex_connection().await?;
    let runtime = state.task_windows().await;
    state.remember_tasks(project_id, [task_id]).await;
    state.retain_task_subscription(task_id).await;
    let (title, status, items) =
        crate::infrastructure::codex::read_task_preview(&connection, project_id, task_id).await?;
    let mut projection = TaskWindowProjection::default();
    projection.title = title.chars().take(160).collect();
    projection.set_status(status);
    for item in &items {
        projection.snapshot_item(item);
    }
    runtime.initialize(label, projection);
    let window = WebviewWindowBuilder::new(app, label, WebviewUrl::App(route.into()))
        .title(&title)
        .inner_size(440.0, 220.0)
        .min_inner_size(360.0, 180.0)
        .resizable(true)
        .maximizable(false)
        .minimizable(false)
        .closable(false)
        .decorations(false)
        // 原生底面必须透明；关闭系统阴影也避免 Windows 无装饰窗口附带的细边框。
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .skip_taskbar(true)
        .focused(false)
        .accept_first_mouse(true)
        .visible(false)
        .build()
        .map_err(|_| AppError::TaskWindowFailed)?;
    #[cfg(target_os = "macos")]
    super::desktop_pet_panel::configure_desktop_overlay(&window).await?;
    #[cfg(target_os = "windows")]
    desktop_pet_platform::configure_windows_desktop_pet(
        window.hwnd().map_err(|_| AppError::TaskWindowFailed)?.0 as isize,
    )
    .map_err(|_| AppError::TaskWindowFailed)?;
    let event_app = app.clone();
    let event_label = label.to_owned();
    window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            let app = event_app.clone();
            let label = event_label.clone();
            tauri::async_runtime::spawn(async move {
                release_window(&app, &label).await;
            });
        }
    });
    window.center().map_err(|_| AppError::TaskWindowFailed)?;
    // 页面与原生面板初始化可能交错，双方都就绪后才显示，避免普通窗口短暂抢焦点。
    if runtime.mark_ready(label) {
        window.show().map_err(|_| AppError::TaskWindowFailed)?;
    }
    Ok(())
}

async fn release_window(app: &AppHandle, label: &str) {
    let state = app.state::<AppState>();
    if let Some((project_id, task_id)) = state.task_windows().await.remove(label) {
        let generation = state.release_task_subscription(&task_id).await;
        super::task_subscription_commands::spawn_task_subscription_release(
            app.clone(),
            project_id,
            task_id,
            generation,
        );
    }
}

#[tauri::command(rename_all = "camelCase")]
pub async fn connect_task_window(
    window: WebviewWindow,
    state: State<'_, AppState>,
    on_update: Channel<TaskWindowPacket>,
) -> Result<(), AppError> {
    let ready = state
        .task_windows()
        .await
        .connect(window.label(), on_update)?;
    if ready {
        window.show().map_err(|_| AppError::TaskWindowFailed)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn acknowledge_task_window(
    window: WebviewWindow,
    state: State<'_, AppState>,
    sequence: u64,
) -> Result<(), AppError> {
    state
        .task_windows()
        .await
        .acknowledge(window.label(), sequence)
}

#[tauri::command]
pub async fn close_task_window(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    state.task_windows().await.route(window.label())?;
    super::desktop_pet_window::destroy_desktop_pet_window(&app, window.label()).await?;
    release_window(&app, window.label()).await;
    Ok(())
}

#[tauri::command]
pub async fn restore_task_window(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let route = state.task_windows().await.route(window.label())?;
    super::app_lifecycle::restore_main_window_at_route(&app, route)
        .map_err(|_| AppError::TaskWindowFailed)?;
    // 主窗口创建、路由投递和显示均成功后才销毁小窗；恢复失败时保留内容供重试。
    close_task_window(app, window, state).await
}

#[tauri::command]
pub async fn drag_task_window(
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    state.task_windows().await.route(window.label())?;
    #[cfg(target_os = "macos")]
    {
        super::desktop_pet_panel::run_desktop_pet_drag(&window).await
    }
    #[cfg(not(target_os = "macos"))]
    {
        window
            .start_dragging()
            .map_err(|_| AppError::TaskWindowFailed)
    }
}
