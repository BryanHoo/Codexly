use tauri::{
    AppHandle, Url,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
};

use super::task_activity::{TaskActivitySnapshot, TaskActivityStatus};
use super::{
    app_lifecycle::{show_main_window, show_main_window_at_route},
    error::AppError,
};

// 原生菜单宽度由最长标题决定，限制为 16 字符以保持紧凑。
const MAX_MENU_TASK_NAME_CHARS: usize = 16;
const MENU_TASK_NAME_ELLIPSIS_CHARS: usize = 3;
const MAX_TRAY_TASKS: usize = 256;
#[cfg(target_os = "macos")]
const MACOS_TRAY_ICON: tauri::image::Image<'_> = tauri::include_image!("./icons/tray-icon.png");
const QUIT_APP_MENU_ID: &str = "quit-app";
const RUNNING_TASK_MENU_PREFIX: &str = "running-task:";
const SHOW_MAIN_MENU_ID: &str = "show-main";
const TRAY_ICON_ID: &str = "codeagent-tray";

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct TrayTask {
    pub(super) project_id: String,
    pub(super) task_id: String,
    pub(super) task_name: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) enum TrayMenuAction {
    ShowMainWindow,
    OpenTask { project_id: String, task_id: String },
    QuitApplication,
    Ignore,
}

pub(crate) fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    #[cfg(target_os = "macos")]
    super::app_lifecycle::configure_macos_quit_menu(app)?;

    let menu = build_tray_menu(app, &[])?;
    let mut tray = TrayIconBuilder::with_id(TRAY_ICON_ID)
        .tooltip("Codexly")
        .menu(&menu)
        .show_menu_on_left_click(tray_show_menu_on_left_click())
        .on_menu_event(|app, event| match tray_menu_action(event.id().as_ref()) {
            TrayMenuAction::ShowMainWindow => show_main_window(app),
            TrayMenuAction::OpenTask {
                project_id,
                task_id,
            } => match tray_task_route(&project_id, &task_id) {
                Ok(route) => show_main_window_at_route(app, route),
                Err(error) => {
                    crate::infrastructure::diagnostics::record_error("tray_task_open_failed", error)
                }
            },
            TrayMenuAction::QuitApplication => super::app_close::request_close_confirmation(app),
            TrayMenuAction::Ignore => {}
        });
    #[cfg(target_os = "macos")]
    {
        // Template 模式让图标自动匹配菜单栏明暗外观和交互状态。
        tray = tray.icon(MACOS_TRAY_ICON).icon_as_template(true);
    }
    #[cfg(not(target_os = "macos"))]
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

pub(super) fn render_tray_task_activities(
    app: &AppHandle,
    activities: &[TaskActivitySnapshot],
) -> Result<(), AppError> {
    render_tray_state(app, &tray_tasks_from_activities(activities))
}

pub(super) fn tray_tasks_from_activities(activities: &[TaskActivitySnapshot]) -> Vec<TrayTask> {
    activities
        .iter()
        .filter(|activity| {
            matches!(
                activity.status,
                TaskActivityStatus::Running | TaskActivityStatus::Waiting
            )
        })
        .take(MAX_TRAY_TASKS)
        .map(|activity| TrayTask {
            project_id: activity.project_id.clone(),
            task_id: activity.task_id.clone(),
            task_name: activity.task_name.clone(),
        })
        .collect()
}

fn render_tray_state(app: &AppHandle, tasks: &[TrayTask]) -> Result<(), AppError> {
    let tray = app
        .tray_by_id(TRAY_ICON_ID)
        .ok_or(AppError::TrayOperationFailed)?;
    let title = tray_title(tasks.len());
    let tooltip = tray_tooltip(tasks.len());
    tray.set_title(title.as_deref())
        .map_err(|_| AppError::TrayOperationFailed)?;
    tray.set_tooltip(Some(tooltip))
        .map_err(|_| AppError::TrayOperationFailed)?;
    let menu = build_tray_menu(app, tasks).map_err(|_| AppError::TrayOperationFailed)?;
    tray.set_menu(Some(menu))
        .map_err(|_| AppError::TrayOperationFailed)
}

pub(super) fn tray_title(task_count: usize) -> Option<String> {
    // macOS tray-icon 对 None 不会清空现有标题，零任务时必须显式写入空字符串。
    Some(if task_count == 0 {
        String::new()
    } else {
        format!(" {task_count}")
    })
}

pub(super) const fn tray_show_menu_on_left_click() -> bool {
    true
}

pub(super) fn tray_tooltip(task_count: usize) -> String {
    if task_count == 0 {
        "Codexly".to_owned()
    } else {
        format!("Codexly · {task_count} 个任务进行中")
    }
}

fn build_tray_menu(app: &AppHandle, tasks: &[TrayTask]) -> tauri::Result<Menu<tauri::Wry>> {
    let menu = Menu::new(app)?;
    let show_main = MenuItem::with_id(app, SHOW_MAIN_MENU_ID, "打开 Codexly", true, None::<&str>)?;
    menu.append(&show_main)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    let heading = MenuItem::with_id(
        app,
        "running-task-heading",
        format!("进行中的任务 ({})", tasks.len()),
        false,
        None::<&str>,
    )?;
    menu.append(&heading)?;
    if tasks.is_empty() {
        let empty = MenuItem::with_id(
            app,
            "running-task-empty",
            "暂无进行中的任务",
            false,
            None::<&str>,
        )?;
        menu.append(&empty)?;
    } else {
        for task in tasks {
            let item = MenuItem::with_id(
                app,
                tray_task_menu_id(task),
                truncate_menu_task_name(&task.task_name),
                true,
                None::<&str>,
            )?;
            menu.append(&item)?;
        }
    }
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    let quit_app = MenuItem::with_id(app, QUIT_APP_MENU_ID, "退出 Codexly", true, None::<&str>)?;
    menu.append(&quit_app)?;
    Ok(menu)
}

pub(super) fn tray_task_menu_id(task: &TrayTask) -> String {
    format!(
        "{RUNNING_TASK_MENU_PREFIX}{}:{}{}",
        task.project_id.len(),
        task.project_id,
        task.task_id
    )
}

pub(super) fn tray_menu_action(menu_id: &str) -> TrayMenuAction {
    match menu_id {
        SHOW_MAIN_MENU_ID => return TrayMenuAction::ShowMainWindow,
        QUIT_APP_MENU_ID => return TrayMenuAction::QuitApplication,
        _ => {}
    }
    let Some(encoded) = menu_id.strip_prefix(RUNNING_TASK_MENU_PREFIX) else {
        return TrayMenuAction::Ignore;
    };
    let Some((project_id_len, target)) = encoded.split_once(':') else {
        return TrayMenuAction::Ignore;
    };
    let Ok(project_id_len) = project_id_len.parse::<usize>() else {
        return TrayMenuAction::Ignore;
    };
    if project_id_len == 0
        || project_id_len >= target.len()
        || !target.is_char_boundary(project_id_len)
    {
        return TrayMenuAction::Ignore;
    }
    let (project_id, task_id) = target.split_at(project_id_len);
    TrayMenuAction::OpenTask {
        project_id: project_id.to_owned(),
        task_id: task_id.to_owned(),
    }
}

pub(super) fn tray_task_route(project_id: &str, task_id: &str) -> Result<String, AppError> {
    let mut url = Url::parse("tauri://localhost/").map_err(|_| AppError::TrayOperationFailed)?;
    let mut segments = url
        .path_segments_mut()
        .map_err(|()| AppError::TrayOperationFailed)?;
    if project_id == "temporary" {
        segments.push("temporary").push("t").push(task_id);
    } else {
        segments.push("p").push(project_id).push("t").push(task_id);
    }
    drop(segments);
    Ok(url.path().trim_start_matches('/').to_owned())
}

fn truncate_menu_task_name(task_name: &str) -> String {
    let mut chars = task_name.chars();
    let label: String = chars
        .by_ref()
        .take(MAX_MENU_TASK_NAME_CHARS - MENU_TASK_NAME_ELLIPSIS_CHARS)
        .collect();
    if chars.next().is_some() {
        format!("{label}...")
    } else {
        label
    }
}

#[cfg(test)]
mod task_name_tests {
    use super::truncate_menu_task_name;

    #[test]
    fn tray_menu_task_names_are_limited_to_16_characters() {
        assert_eq!(truncate_menu_task_name("Short task"), "Short task");
        assert_eq!(
            truncate_menu_task_name("1234567890123456789012345678901234567890"),
            "1234567890123..."
        );
    }
}
