mod app_close;
pub(super) mod app_lifecycle;
mod app_minimize;
pub mod app_storage_commands;
pub(crate) mod app_storage_runtime;
#[cfg(test)]
mod app_storage_runtime_tests;
mod app_update;
pub mod attachment_commands;
pub mod background_commands;
pub mod catalog_commands;
pub mod commands;
pub mod desktop_pet_commands;
#[cfg(target_os = "macos")]
mod desktop_pet_panel;
mod desktop_pet_window;
pub mod diagnostic_commands;
pub mod error;
pub mod extension_commands;
mod model_turn_waiters;
pub mod notification_commands;
pub mod open_commands;
pub mod pending_resolution;
pub mod personalization_commands;
mod pet_assets;
pub mod pet_commands;
pub mod project_file_window_commands;
pub mod prompt_submission;
mod queue_add;
pub mod queue_start;
mod queue_start_recovery;
pub mod queued_steer;
mod request_cancellation;
pub mod review_submission;
pub mod scheduled_task_commands;
mod scheduled_task_runner;
pub mod scheduled_task_runtime;
#[cfg(test)]
mod scheduled_task_runtime_tests;
pub mod sidebar_commands;
pub mod sidebar_directory_commands;
mod sidebar_prompt_title;
mod sidebar_task_settings;
pub mod skills_market_commands;
pub mod state;
pub mod steer_submission;
mod task_activity;
pub mod task_activity_commands;
#[cfg(test)]
mod task_activity_tests;
pub mod task_board_commands;
mod task_creation;
pub mod task_fork_commands;
mod task_subscription;
pub mod task_subscription_commands;
#[cfg(test)]
mod task_subscription_tests;
mod task_title_generation;
pub mod task_window_commands;
mod task_window_runtime;
mod task_window_stream;
#[cfg(test)]
mod task_window_tests;
mod task_workspace;
pub mod temporary_workspace_commands;
pub mod terminal_commands;
pub(crate) mod terminal_lifecycle;
#[cfg(feature = "webview-tests")]
pub mod terminal_probe;
mod terminal_project;
pub mod tray_commands;
#[cfg(test)]
mod tray_commands_tests;
mod turn_start;
mod turn_waiters;
pub mod workflow_commands;
pub mod workspace_commands;

pub mod search_commands;
