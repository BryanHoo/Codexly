use super::runtime_manager::{inspect_codex_runtime, install_codex_runtime};
use crate::domain::runtime::CodexRuntimeAvailabilityStatus as Status;

#[tokio::test]
async fn missing_bundle_returns_immediately_without_network_or_installation() {
    let directory = tempfile::tempdir().unwrap();
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(1),
        install_codex_runtime(directory.path(), |_| panic!("must not install")),
    )
    .await
    .unwrap();
    assert!(result.is_err());
    assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 0);
}

#[tokio::test]
async fn startup_should_report_filesystem_failure_without_installing() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("app");
    std::fs::write(&root, "not a directory").unwrap();
    let state = crate::application::state::AppState::default();
    let result = state
        .inspect_codex(&root, |_| panic!("must not download or install"))
        .await;
    assert_eq!(result.status, Status::Failed);
}

#[tokio::test]
async fn old_user_installation_never_overrides_bundled_runtime() {
    let directory = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(directory.path().join("providers/codex/bin/0.163.0/bin")).unwrap();
    std::fs::write(
        directory.path().join("providers/codex/active.json"),
        r#"{"path":"/tmp/codex","version":"0.163.0"}"#,
    )
    .unwrap();
    assert_eq!(
        inspect_codex_runtime(directory.path()).await.status,
        Status::Missing
    );
}

#[cfg(unix)]
#[tokio::test]
async fn bundled_runtime_checks_version_and_rejects_corruption() {
    use super::runtime_manager::bundled_codex_binary_path;
    use std::os::unix::fs::PermissionsExt;
    let directory = tempfile::tempdir().unwrap();
    let binary = bundled_codex_binary_path(directory.path());
    std::fs::create_dir_all(binary.parent().unwrap()).unwrap();
    std::fs::write(&binary, "#!/bin/sh\necho 'codex-cli 0.163.0'\n").unwrap();
    std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o755)).unwrap();
    assert_eq!(
        install_codex_runtime(directory.path(), |_| panic!("must not install"))
            .await
            .unwrap()
            .status,
        Status::Compatible
    );
    std::fs::write(&binary, "#!/bin/sh\necho 'codex-cli 0.150.0'\n").unwrap();
    assert_eq!(
        inspect_codex_runtime(directory.path()).await.status,
        Status::Incompatible
    );
    std::fs::write(&binary, "corrupt").unwrap();
    assert_eq!(
        inspect_codex_runtime(directory.path()).await.status,
        Status::Failed
    );
}
