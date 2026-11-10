use super::*;

#[tokio::test]
async fn acp_prepare_should_reject_missing_resources_and_retry_after_repair() {
    let root = tempfile::tempdir().unwrap();
    let manager = AcpRuntimeManager::default();
    assert!(manager.prepare(root.path()).await.is_err());
    let platform = if cfg!(target_os = "macos") {
        "darwin"
    } else if cfg!(windows) {
        "win32"
    } else {
        "linux"
    };
    let arch = if cfg!(target_arch = "aarch64") {
        "arm64"
    } else {
        "x64"
    };
    let manifest = serde_json::json!({"schemaVersion":1,"platform":platform,"arch":arch,
        "host":{"path":"host","protocolVersion":1},
        "engines":{"codex":{"version":"0.166.0","entrypoint":"codex"},"claude":{"version":"2.1.318","sdkVersion":"0.3.318","entrypoint":"claude"}}});
    std::fs::write(root.path().join("manifest.json"), manifest.to_string()).unwrap();
    for name in ["host", "codex", "claude"] {
        std::fs::write(root.path().join(name), "binary").unwrap();
    }
    let paths = manager.prepare(root.path()).await.unwrap();
    assert_eq!(
        paths.host,
        std::fs::canonicalize(root.path().join("host")).unwrap()
    );
    assert_eq!(
        paths.codex,
        std::fs::canonicalize(root.path().join("codex")).unwrap()
    );
    assert_eq!(
        paths.claude,
        std::fs::canonicalize(root.path().join("claude")).unwrap()
    );
    assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 4);
}

#[cfg(unix)]
#[tokio::test]
async fn acp_prepare_should_reject_a_symlinked_executable() {
    let root = tempfile::tempdir().unwrap();
    assert!(
        controlled_executable(root.path(), "../outside")
            .await
            .is_err()
    );
    let outside = tempfile::NamedTempFile::new().unwrap();
    std::os::unix::fs::symlink(outside.path(), root.path().join("host")).unwrap();
    assert!(controlled_executable(root.path(), "host").await.is_err());
}
