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
        b"#!/bin/sh\nsleep 6\nprintf 'codex-cli 0.157.1\\n'\n",
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
        Path::new("/application-data/providers/codex/bin/0.157.1/bin")
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
            "PscZvqKD4zlaSw1nM5Sh4lU1M+01sr4b3qzGx8pf+4OLyULg1z1yAyTR1c35C3t62H8DXy/14y7oazTR3JMMKA==",
        ),
        (
            "macos",
            "aarch64",
            "aarch64-apple-darwin",
            "darwin-arm64",
            "62/e4TZ34z93KK3FYIHmo/K88aH0JRPA8x7SAVBdK4iG9f9HPO2tsDrJcmOj9z6DrFpMvPEVymomCbYpqN+ylQ==",
        ),
        (
            "linux",
            "aarch64",
            "aarch64-unknown-linux-musl",
            "linux-arm64",
            "nEaBZT3ldrtqUNaBlvI+Y+fg+LbNCTsQjbUnl7Q45rl9vSSqHU2vRj1l6iJDwupZkrpeIJ/ClHIwxgMKv1SKHg==",
        ),
        (
            "linux",
            "x86_64",
            "x86_64-unknown-linux-musl",
            "linux-x64",
            "Eac8XlC0nCXSeUjDU9l8yLJ6P9evv1mO+AnvILoNwlegBC7B3AVXqJ05QcMhQX7RcJ3Lk2618ykCb2X2ui8VAQ==",
        ),
        (
            "windows",
            "aarch64",
            "aarch64-pc-windows-msvc",
            "win32-arm64",
            "tFkxdrSXPUDQXXp3JwTxNOgI17RQcexyuaZTiNmL1A/UaVtVmVBNe+8cBk3r8b7dLpaoWFbjPwL7p5SBCrkLQg==",
        ),
        (
            "windows",
            "x86_64",
            "x86_64-pc-windows-msvc",
            "win32-x64",
            "vgqs/VRXNwhLYMsZDgYfnRSXpRh5Nm782L8lacGskw86kOxbMaquvQKxkuZHUBrJA2XGcksB7rMUHy1XaCJgrA==",
        ),
    ];

    for (os, arch, target, package_suffix, integrity) in cases {
        let distribution = distribution_for(os, arch).unwrap();
        assert_eq!(distribution.target, target);
        assert_eq!(
            distribution.fallback_url,
            format!(
                "https://registry.npmjs.org/@openai/codex/-/codex-0.157.1-{package_suffix}.tgz"
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
        binary(&alternate, "0.157.1");
        std::fs::write(
            root.join("providers/codex/active.json"),
            serde_json::to_vec(&serde_json::json!({"path": alternate, "version": "0.157.1"}))
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
        binary(&private_codex_binary_path(&root), "0.157.1");
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
