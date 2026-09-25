mod attachments;
mod file_search;
mod file_search_index;
mod files;
mod git_capture;
mod git_commit_context;
mod git_diff;
mod git_history;
mod git_index_selection;
mod git_models;
mod git_patch;
mod git_process;
mod git_protocol;
mod git_read;
mod git_repository;
mod git_snapshot;
mod git_stats;
mod git_status_page;
mod git_status_parse;
mod git_stream;
mod git_untracked;
mod git_worktree;
mod git_write;
mod open;
mod path_guard;
#[cfg(test)]
mod performance_baseline_tests;

#[cfg(test)]
mod git_boundary_tests;
#[cfg(test)]
mod git_diff_tests;
#[cfg(test)]
mod git_integrity_tests;
#[cfg(test)]
mod git_output_tests;
#[cfg(test)]
mod git_read_regression_tests;
#[cfg(test)]
mod git_scale_tests;
#[cfg(test)]
mod git_stats_tests;
#[cfg(test)]
mod git_tests;

pub use attachments::{
    import_attachment, store_attachment, validate_attachment, validate_generated_attachment,
};
pub use file_search::ProjectFileSearch;
pub use files::{delete_project_file, list_project_files, read_source_file, rename_project_file};
pub use git_commit_context::prepare_commit_message;
pub use git_read::{get_commit_diff, get_commit_files, get_git_file_status, get_git_history};
pub use git_status_page::get_git_status_page;
pub use git_worktree::{create_worktree, list_worktrees, switch_worktree};
pub use git_write::{commit_changes, create_branch, switch_branch};
pub use open::{open_path, platform_apps, reveal_path};
pub use path_guard::{WorkspaceError, canonical_root, resolve_existing};

#[cfg(test)]
pub use git_read::get_git_status;
