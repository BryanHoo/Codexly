use super::*;

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
