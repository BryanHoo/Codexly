use super::runtime_discovery::private_codex_binary_path;
use super::runtime_manager::distribution_for;
use std::path::Path;

#[cfg(unix)]
#[tokio::test]
async fn staged_runtime_should_allow_cold_launch_without_relaxing_regular_probes() {
    use super::process::{ProcessError, probe_codex_version};
    use std::os::unix::fs::PermissionsExt;
    let root = std::env::temp_dir().join(format!("codeagent-cold-probe-{}", std::process::id()));
    std::fs::create_dir_all(&root).unwrap();
    let binary = root.join("codex");
    // 同一进程延迟用于验证安装与日常探测的不同预算，不依赖网络或 macOS 缓存。
    std::fs::write(
        &binary,
        b"#!/bin/sh\nsleep 6\nprintf 'codex-cli 0.156.0\\n'\n",
    )
    .unwrap();
    std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o755)).unwrap();
    let probe = probe_codex_version(&binary, None).await;
    assert!(
        matches!(probe, Err(ProcessError::VersionProbeTimeout)),
        "regular probe should time out: {probe:?}"
    );
    let result = super::runtime_manager::validate_staged_runtime(&binary).await;
    std::fs::remove_dir_all(&root).unwrap();
    assert!(result.is_ok(), "cold install should validate: {result:?}");
}

#[test]
fn runtime_download_should_prefer_the_domestic_mirror_on_every_platform() {
    for (os, arch) in [
        ("macos", "aarch64"),
        ("macos", "x86_64"),
        ("linux", "aarch64"),
        ("linux", "x86_64"),
        ("windows", "aarch64"),
        ("windows", "x86_64"),
    ] {
        let distribution = distribution_for(os, arch).unwrap();
        assert!(
            distribution
                .url
                .starts_with("https://registry.npmmirror.com/"),
            "unexpected primary download URL: {}",
            distribution.url
        );
    }
}
#[test]
fn private_runtime_should_use_the_provider_version_directory() {
    assert_eq!(
        private_codex_binary_path(Path::new("/application-data")),
        Path::new("/application-data/providers/codex/bin/0.156.0/bin")
            .join(format!("codex{}", std::env::consts::EXE_SUFFIX))
    );
}

#[test]
fn distribution_should_be_fixed_to_the_official_supported_package() {
    let cases = [
        (
            "macos",
            "x86_64",
            "x86_64-apple-darwin",
            "darwin-x64",
            "fD6Nxn7rxinrE6JRxN1liMH3rIV2j9HjcszwMprgs3Ka2p6rR60CmvN03RsWOT4vCcxnA7Evhpnm+bCTNVhH+g==",
        ),
        (
            "macos",
            "aarch64",
            "aarch64-apple-darwin",
            "darwin-arm64",
            "43/9bryLjRA+g7z1AGeFS8AQiChmG52nIhzMkxjNAXcxEBMVsA88YGBosk0ndThjgTGB42vK82BQV3DR6OBsGQ==",
        ),
        (
            "linux",
            "aarch64",
            "aarch64-unknown-linux-musl",
            "linux-arm64",
            "IfUrjxm8RAdzPgqlPhUXTJ4mGKKbuTKsNixiXoiRzNkd9kNLj/fUmOQYCcWu+3Dk77b4OH1itnoIRAcFimNzNQ==",
        ),
        (
            "linux",
            "x86_64",
            "x86_64-unknown-linux-musl",
            "linux-x64",
            "/PX399ISB715skgBBOtOX5aqLxmPQhYC7wDasZnAJhRrtzt3qgs6kjSnimN9T8OFKv4LDAp+uJdN896tQYaTrA==",
        ),
        (
            "windows",
            "aarch64",
            "aarch64-pc-windows-msvc",
            "win32-arm64",
            "kDs2Sz+oDAcAm6n5C1TkN6qy7ZNWZiDPM7Uj0Z913I+SFLOYTkF/OB2SWYFG73jF/gKLrkIpWZFdIvFUaMBWfw==",
        ),
        (
            "windows",
            "x86_64",
            "x86_64-pc-windows-msvc",
            "win32-x64",
            "9y+shxtHJn7yrmZqF4gs9oK1Tte9Heshkda8TrTiAf3bPn24cgOq+avZ+Mad54I3M2R8AFeqt0hT/aS6s5cbAQ==",
        ),
    ];

    for (os, arch, target, package_suffix, integrity) in cases {
        let distribution = distribution_for(os, arch).unwrap();
        assert_eq!(distribution.target, target);
        assert_eq!(
            distribution.fallback_url,
            format!(
                "https://registry.npmjs.org/@openai/codex/-/codex-0.156.0-{package_suffix}.tgz"
            )
        );
        assert_eq!(distribution.integrity, integrity);
    }
}

#[test]
fn unsupported_architecture_should_not_select_a_runtime() {
    assert!(distribution_for("macos", "i686").is_none());
}

#[cfg(unix)]
mod private_runtime {
    use super::super::runtime_manager::{inspect_codex_runtime, install_codex_runtime};
    use super::*;
    use crate::domain::runtime::CodexRuntimeAvailabilityStatus as Status;
    use std::os::unix::fs::PermissionsExt;

    fn fixture() -> tempfile::TempDir {
        // 独占临时目录避免并发测试取得相同时间戳后互相覆盖。
        tempfile::tempdir().unwrap()
    }

    fn binary(path: &Path, version: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, format!("#!/bin/sh\necho 'codex-cli {version}'\n")).unwrap();
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
    }

    #[tokio::test]
    async fn startup_should_attempt_private_install_and_report_filesystem_failure() {
        let directory = fixture();
        let root = directory.path().join("app");
        std::fs::write(&root, "blocks application data directory").unwrap();
        let events = std::sync::Mutex::new(Vec::new());
        let state = crate::application::state::AppState::default();
        let result = state
            .inspect_codex(&root, |event| events.lock().unwrap().push(event))
            .await;
        assert_eq!(result.status, Status::Failed);
        let events = events.lock().unwrap();
        assert_eq!(
            events.first().map(|event| event.phase),
            Some(crate::domain::runtime::CodexRuntimeInstallPhase::Preparing)
        );
        assert_eq!(
            events.last().map(|event| event.phase),
            Some(crate::domain::runtime::CodexRuntimeInstallPhase::Failed)
        );
        std::fs::remove_file(root).unwrap();
    }

    #[tokio::test]
    async fn inspection_should_ignore_active_manifest_redirects() {
        let directory = fixture();
        let root = directory.path().join("app");
        let alternate = root.join("providers/codex/bin/alternate/bin/codex");
        binary(&alternate, "0.156.0");
        std::fs::write(
            root.join("providers/codex/active.json"),
            serde_json::to_vec(&serde_json::json!({"path": alternate, "version": "0.156.0"}))
                .unwrap(),
        )
        .unwrap();
        assert_eq!(inspect_codex_runtime(&root).await.status, Status::Missing);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn installation_should_reuse_valid_private_binary_without_progress_or_manifest_writes() {
        let directory = fixture();
        let root = directory.path().join("app");
        binary(&private_codex_binary_path(&root), "0.156.0");
        let result = install_codex_runtime(&root, |_| panic!("healthy runtime must not install"))
            .await
            .unwrap();
        assert_eq!(result.status, Status::Compatible);
        assert!(!root.join("providers/codex/active.json").exists());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn inspection_should_reject_wrong_version_and_corrupt_private_binary() {
        let directory = fixture();
        let root = directory.path().join("app");
        let path = private_codex_binary_path(&root);
        binary(&path, "0.150.0");
        let result = inspect_codex_runtime(&root).await;
        assert_eq!(result.status, Status::Incompatible);
        assert_eq!(result.detected_version.as_deref(), Some("0.150.0"));
        std::fs::write(&path, "corrupt").unwrap();
        assert_eq!(inspect_codex_runtime(&root).await.status, Status::Failed);
        std::fs::remove_dir_all(root).unwrap();
    }
}
