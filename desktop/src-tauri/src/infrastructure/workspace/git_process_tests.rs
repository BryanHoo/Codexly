#[cfg(unix)]
use std::time::Duration;
use std::{env, path::Path};

#[cfg(windows)]
use super::git_path_argument;
use super::{
    BoundedCapture, LOCAL_GIT_TIMEOUT, NETWORK_GIT_TIMEOUT, first_existing_path, git_failure,
};
#[cfg(unix)]
use super::{run_git_command, unix_kill_process_group_args};

#[test]
fn bounded_capture_should_preserve_head_and_tail() {
    let mut capture = BoundedCapture::new(6);
    assert!(capture.push(b"0123456789"));
    assert_eq!(capture.into_bytes(), b"012789");
}

#[test]
fn network_git_should_allow_more_time_than_local_git() {
    assert!(NETWORK_GIT_TIMEOUT > LOCAL_GIT_TIMEOUT);
}

#[test]
fn git_discovery_should_select_the_first_existing_file() {
    let current_executable = env::current_exe().expect("test executable should exist");
    let missing = current_executable.join("missing-git");

    assert_eq!(
        first_existing_path([missing, current_executable.clone()]),
        Some(current_executable)
    );
}

#[test]
fn branch_switch_should_classify_local_changes_without_losing_git_details() {
    let detail = "error: Your local changes to the following files would be overwritten by checkout:\n\tsrc/main.rs\nPlease commit your changes or stash them before you switch branches.\nAborting";

    let error = git_failure(
        &["switch", "--", "feature"],
        "failed with exit code: 1".to_owned(),
        detail.as_bytes(),
    );

    assert_eq!(
        (error.code(), error.to_string()),
        (
            "GIT_LOCAL_CHANGES_OVERWRITTEN",
            format!("git switch failed with exit code: 1: {detail}")
        )
    );
}

#[cfg(windows)]
#[test]
fn git_paths_should_remove_windows_verbatim_prefixes() {
    assert_eq!(
        git_path_argument(Path::new(r"\\?\C:\workspace\repo")),
        r"C:\workspace\repo"
    );
    assert_eq!(
        git_path_argument(Path::new(r"\\?\UNC\server\share\repo")),
        r"\\server\share\repo"
    );
}

#[cfg(unix)]
#[test]
fn unix_process_group_kill_should_terminate_option_parsing_before_negative_pgid() {
    assert_eq!(unix_kill_process_group_args(42), ["-KILL", "--", "-42"]);
}

#[cfg(unix)]
#[tokio::test]
async fn timeout_should_kill_git_descendants_holding_pipes() {
    let args = ["-c", "alias.hang=!sh -c 'sleep 60 &'", "hang"];
    let result = tokio::time::timeout(
        Duration::from_secs(5),
        run_git_command(
            Path::new("/"),
            &args,
            1024,
            None,
            None,
            Duration::from_millis(100),
            false,
        ),
    )
    .await
    .expect("Git descendants should not outlive the timeout");

    assert!(result.is_err());
}
