mod agent_settings;
#[cfg(test)]
mod agent_settings_tests;
mod auth;
mod catalogs;
mod commit_message;
mod config;
mod connection;
mod connection_diagnostics;
mod connection_event_buffer;
mod connection_message_channel;
pub(crate) use connection_message_channel::ServerMessageReceiver;
#[cfg(test)]
pub(crate) use connection_message_channel::server_message_channel;
mod conversation;
mod conversation_advanced;
mod conversation_background;
mod conversation_collaboration;
mod conversation_commands;
mod task_workspace;
pub use task_workspace::update_task_workspace;
mod conversation_delta_events;
mod conversation_events;
mod conversation_file_input;
mod conversation_items;
mod conversation_media_input;
mod conversation_plugin_install;
mod conversation_prompt;
mod conversation_questions;
mod conversation_queue;
mod conversation_queue_move;
mod conversation_queue_snapshot;
mod conversation_request_fields;
mod conversation_requests;
mod conversation_runtime_events;
mod conversation_turn_settings;
mod generated_image_store;
pub mod personalization;
mod plugin_assets;
mod plugins;
mod process;
mod protocol;
mod runtime_active;
mod runtime_discovery;
mod runtime_distributions;
mod runtime_download;
mod runtime_download_progress;
mod runtime_manager;
mod runtime_path;
mod sidebar;
mod stderr;
pub mod task_title;
mod tasks;

#[cfg(test)]
#[path = "auth_connection_tests.rs"]
mod auth_connection_tests;
#[cfg(test)]
#[path = "auth_model_fallback_tests.rs"]
mod auth_model_fallback_tests;
#[cfg(test)]
#[path = "auth_provider_config_tests.rs"]
mod auth_provider_config_tests;
#[cfg(test)]
#[path = "auth_tests.rs"]
mod auth_tests;
#[cfg(test)]
#[path = "catalogs_tests.rs"]
mod catalogs_tests;
#[cfg(test)]
#[path = "codex_152_contract_tests.rs"]
mod codex_152_contract_tests;

#[cfg(test)]
mod codex_153_contract_tests;
#[cfg(test)]
mod codex_154_contract_tests;
#[cfg(test)]
mod codex_156_contract_tests;
#[cfg(test)]
#[path = "connection_message_tests.rs"]
mod connection_message_tests;
#[cfg(test)]
#[path = "connection_retry_tests.rs"]
mod connection_retry_tests;
#[cfg(test)]
mod conversation_153_settings_tests;
#[cfg(test)]
#[path = "conversation_advanced_tests.rs"]
mod conversation_advanced_tests;
#[cfg(test)]
#[path = "conversation_approval_tests.rs"]
mod conversation_approval_tests;
#[cfg(test)]
#[path = "conversation_command_tests.rs"]
mod conversation_command_tests;
#[cfg(test)]
#[path = "conversation_error_tests.rs"]
mod conversation_error_tests;
#[cfg(test)]
#[path = "conversation_item_tests.rs"]
mod conversation_item_tests;
#[cfg(test)]
#[path = "conversation_plugin_install_tests.rs"]
mod conversation_plugin_install_tests;
#[cfg(test)]
mod conversation_request_mapping_tests;
#[cfg(test)]
mod conversation_skill_tests;
#[cfg(test)]
#[path = "conversation_tests.rs"]
mod conversation_tests;
#[cfg(test)]
#[path = "runtime_manager_tests.rs"]
mod runtime_manager_tests;

pub use agent_settings::{
    AgentSettingsError, read_agent_runtime_settings, read_global_settings, read_project_defaults,
    update_global_settings,
};
pub use auth::{
    ProviderError, cancel_provider_login, configure_custom_provider, get_provider_connection,
    list_provider_models, logout_provider, start_official_provider_login,
};
pub use catalogs::{
    list_configured_mcp_servers, list_installed_skills, list_mcp_servers, list_skills,
    reload_mcp_servers, set_mcp_server_enabled, set_skill_enabled,
};
pub use commit_message::{
    parse_commit_message_output, resolve_commit_message_settings, start_commit_message_thread,
    start_commit_message_turn,
};
pub(crate) use connection::ConnectionError;
pub use connection::{AppServerConnection, ServerMessage};
pub(crate) use connection_event_buffer::EVENT_RETENTION_EXCEEDED_METHOD;
pub(crate) use conversation::RUNTIME_SESSION_ID;
pub use conversation::{read_task_preview, read_task_snapshot};
pub use conversation_advanced::{
    clear_goal, compact_task, fork_task, set_goal_objective, start_review, update_goal,
    upload_feedback,
};
pub use conversation_background::{list_background_terminals, terminate_background_terminal};
pub use conversation_commands::{
    interrupt_turn, start_task, start_turn, steer_turn, update_thread_settings,
};
pub use conversation_events::map_server_event_now;
pub use conversation_queue::{
    add_queued_submission, delete_queued_submission, start_queued_submission,
};
pub use conversation_queue_move::move_queued_submission;
pub use conversation_queue_snapshot::read_queued_submissions;
pub(crate) use conversation_requests::MappedServerRequest;
pub use conversation_requests::{
    PendingServerRequest, map_server_request_now, resolved_request_id, response_for_resolution,
};
pub use conversation_turn_settings::update_live_reviewer;
pub use plugins::{
    get_official_plugin, install_official_plugin, list_official_plugins, uninstall_official_plugin,
};
pub use process::CodexProcess;
pub use runtime_manager::{inspect_codex_runtime, install_codex_runtime};
pub use sidebar::{
    add_project, list_projects, read_project, remove_project, rename_project, reorder_projects,
};
pub use tasks::{
    archive_task, delete_task, list_completed_tasks, list_tasks, pin_task, read_task, rename_task,
    task_working_directory, unarchive_task, unsubscribe_task,
};
mod conversation_access;
mod model_cache;
#[cfg(test)]
mod turn_readiness_tests;
pub use conversation_access::{ensure_task_writer, retain_task_writer};
#[cfg(test)]
mod model_cache_tests;

mod search;
pub use search::{search_task_occurrences, search_tasks};
