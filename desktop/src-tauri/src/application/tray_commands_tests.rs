use super::task_activity::{TaskActivitySnapshot, TaskActivityStatus};
use super::tray_commands::{
    TrayMenuAction, TrayTask, tray_menu_action, tray_show_menu_on_left_click, tray_task_menu_id,
    tray_task_route, tray_tasks_from_activities, tray_title, tray_tooltip,
};

fn running_task() -> TrayTask {
    TrayTask {
        project_id: "project-1".to_owned(),
        task_id: "task-1".to_owned(),
        task_name: "Implement tray status".to_owned(),
    }
}

#[test]
fn tray_count_is_rendered_next_to_the_icon_and_in_the_tooltip() {
    assert_eq!(tray_title(0).as_deref(), Some(""));
    assert_eq!(tray_title(2).as_deref(), Some(" 2"));
    assert_eq!(tray_tooltip(0), "Codexly");
    assert_eq!(tray_tooltip(2), "Codexly · 2 个任务进行中");
}

#[test]
fn tray_left_click_opens_the_menu() {
    assert!(tray_show_menu_on_left_click());
}

#[test]
fn tray_projects_the_rust_owned_active_task_snapshot() {
    let activities = vec![
        TaskActivitySnapshot {
            project_id: "project-1".to_owned(),
            requires_approval: false,
            root_path: None,
            started_at: Some("2026-09-02T08:00:00Z".to_owned()),
            status: TaskActivityStatus::Running,
            task_id: "task-1".to_owned(),
            task_name: "底层任务标题".to_owned(),
        },
        TaskActivitySnapshot {
            project_id: "project-1".to_owned(),
            requires_approval: false,
            root_path: None,
            started_at: None,
            status: TaskActivityStatus::Completed,
            task_id: "task-2".to_owned(),
            task_name: "已完成任务".to_owned(),
        },
    ];

    assert_eq!(
        tray_tasks_from_activities(&activities),
        vec![TrayTask {
            project_id: "project-1".to_owned(),
            task_id: "task-1".to_owned(),
            task_name: "底层任务标题".to_owned(),
        }]
    );
}

#[test]
fn tray_task_menu_ids_round_trip_to_navigation_targets() {
    let task = running_task();

    assert_eq!(
        tray_menu_action("show-main"),
        TrayMenuAction::ShowMainWindow
    );
    assert_eq!(
        tray_menu_action("quit-app"),
        TrayMenuAction::QuitApplication
    );
    assert_eq!(tray_menu_action("unknown"), TrayMenuAction::Ignore);
    assert_eq!(tray_menu_action("hold-to-quit-app"), TrayMenuAction::Ignore);
    assert_eq!(
        tray_menu_action(&tray_task_menu_id(&task)),
        TrayMenuAction::OpenTask {
            project_id: task.project_id.clone(),
            task_id: task.task_id.clone(),
        }
    );
    assert_eq!(
        tray_task_route("project-1", "task-1").unwrap(),
        "p/project-1/t/task-1"
    );
    assert_eq!(
        tray_task_route("temporary", "task-2").unwrap(),
        "temporary/t/task-2"
    );
}
