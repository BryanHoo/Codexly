use super::*;

#[tokio::test]
async fn bundled_claude_version_reads_only_the_manifest_without_runtime_binaries() {
    let directory = tempfile::tempdir().unwrap();
    let claude = directory.path().join("claude");
    std::fs::create_dir(&claude).unwrap();
    for version in ["2.1.300", "2.1.300-rc.1+build.5"] {
        std::fs::write(
            claude.join("manifest.json"),
            serde_json::json!({
                "schemaVersion": 1,
                "sdkVersion": "0.3.300",
                "claudeCodeVersion": version,
                "native": { "version": "0.3.300" },
            })
            .to_string(),
        )
        .unwrap();
        assert_eq!(
            bundled_claude_version(directory.path()).await.as_deref(),
            Some(version)
        );
    }
    // 没有 CLI 或宿主也能展示版本，证明关于页不依赖运行时准备或进程探测。
    assert_eq!(std::fs::read_dir(&claude).unwrap().count(), 1);
}

#[tokio::test]
async fn bundled_claude_version_missing_resources_degrades_without_creating_files() {
    let directory = tempfile::tempdir().unwrap();
    assert_eq!(bundled_claude_version(directory.path()).await, None);
    assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 0);
    std::fs::create_dir(directory.path().join("claude")).unwrap();
    assert_eq!(bundled_claude_version(directory.path()).await, None);
    assert_eq!(
        std::fs::read_dir(directory.path().join("claude"))
            .unwrap()
            .count(),
        0
    );
}

#[tokio::test]
async fn bundled_claude_version_rejects_old_damaged_and_invalid_manifests() {
    let directory = tempfile::tempdir().unwrap();
    let claude = directory.path().join("claude");
    std::fs::create_dir(&claude).unwrap();
    let manifest = claude.join("manifest.json");
    for bytes in [
        b"".as_slice(),
        b"{broken",
        b"\xff",
        br#"{"sdkVersion":"0.3.300","native":{"version":"0.3.300"}}"#,
        br#"{"claudeCodeVersion":null}"#,
        br#"{"claudeCodeVersion":21300}"#,
    ] {
        std::fs::write(&manifest, bytes).unwrap();
        assert_eq!(bundled_claude_version(directory.path()).await, None);
    }
    for version in [
        "",
        "2",
        "2.1",
        "v2.1.300",
        " 2.1.300",
        "2.1.300\n",
        "02.1.300",
        "2.1.0300",
        "2.1.300.1",
        "2.1.300-01",
        "2.1.300-",
        "latest",
        "^2.1.300",
    ] {
        std::fs::write(
            &manifest,
            serde_json::json!({ "claudeCodeVersion": version }).to_string(),
        )
        .unwrap();
        assert_eq!(
            bundled_claude_version(directory.path()).await,
            None,
            "must reject invalid semantic version {version:?}"
        );
    }
    // 即便超大文件仍包含合法 JSON，也只读取固定上限并将其视为损坏清单。
    let oversized = format!(
        "{}{}",
        r#"{"claudeCodeVersion":"2.1.300"}"#,
        " ".repeat(16 * 1024)
    );
    std::fs::write(&manifest, oversized).unwrap();
    assert_eq!(bundled_claude_version(directory.path()).await, None);
}

#[tokio::test]
async fn missing_bundled_claude_never_downloads_or_creates_files() {
    let directory = tempfile::tempdir().unwrap();
    let manager = ClaudeRuntimeManager::default();
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(1),
        manager.prepare(
            directory.path(),
            directory
                .path()
                .join("claude")
                .join(format!("claude-host{}", std::env::consts::EXE_SUFFIX)),
            |_| panic!("must not install"),
        ),
    )
    .await
    .unwrap();
    assert!(result.is_err());
    assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 0);
}

#[tokio::test]
async fn bundled_claude_is_used_in_place_without_copy_or_install_progress() {
    let directory = tempfile::tempdir().unwrap();
    let claude = directory.path().join("claude");
    std::fs::create_dir(&claude).unwrap();
    let binary = claude.join(format!("claude{}", std::env::consts::EXE_SUFFIX));
    let host = claude.join(format!("claude-host{}", std::env::consts::EXE_SUFFIX));
    std::fs::write(&binary, "native").unwrap();
    std::fs::write(&host, "host").unwrap();
    let manager = ClaudeRuntimeManager::default();
    assert_eq!(
        manager
            .prepare(directory.path(), host.clone(), |_| panic!(
                "must not install"
            ))
            .await
            .unwrap(),
        (binary, host)
    );
    assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 1);
}

#[tokio::test]
async fn incomplete_bundle_can_retry_after_repair() {
    let directory = tempfile::tempdir().unwrap();
    let claude = directory.path().join("claude");
    std::fs::create_dir(&claude).unwrap();
    let binary = claude.join(format!("claude{}", std::env::consts::EXE_SUFFIX));
    let host = claude.join(format!("claude-host{}", std::env::consts::EXE_SUFFIX));
    std::fs::write(&binary, "native").unwrap();
    std::fs::write(&host, "").unwrap();
    let manager = ClaudeRuntimeManager::default();
    assert!(
        manager
            .prepare(
                directory.path(),
                directory
                    .path()
                    .join("claude")
                    .join(format!("claude-host{}", std::env::consts::EXE_SUFFIX)),
                |_| {}
            )
            .await
            .is_err()
    );
    std::fs::write(&host, "host").unwrap();
    assert!(
        manager
            .prepare(
                directory.path(),
                directory
                    .path()
                    .join("claude")
                    .join(format!("claude-host{}", std::env::consts::EXE_SUFFIX)),
                |_| {}
            )
            .await
            .is_ok()
    );
}
