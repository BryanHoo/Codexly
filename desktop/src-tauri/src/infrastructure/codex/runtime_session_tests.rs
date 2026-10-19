use super::runtime_session_id;

#[test]
fn runtime_session_identity_child() {
    // 子进程使用同一个测试二进制，只读取会话标识，不启动桌面或引擎。
    if std::env::var_os("CODEXLY_SESSION_ID_CHILD").is_some() {
        println!("runtime-session={}", runtime_session_id());
    }
}

#[test]
fn runtime_session_identity_should_change_after_process_restart() {
    let id = runtime_session_id();
    assert_eq!(id, runtime_session_id());
    assert!(uuid::Uuid::parse_str(id).is_ok());
    let executable = std::env::current_exe().unwrap();
    let mut child_ids = Vec::new();
    for _ in 0..2 {
        let output = std::process::Command::new(&executable)
            .args(["--exact", "infrastructure::codex::conversation::runtime_session_tests::runtime_session_identity_child", "--nocapture"])
            .env("CODEXLY_SESSION_ID_CHILD", "1")
            .output().unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let stdout = String::from_utf8(output.stdout).unwrap();
        let child_id = stdout
            .lines()
            .find_map(|line| line.strip_prefix("runtime-session="))
            .unwrap();
        assert!(uuid::Uuid::parse_str(child_id).is_ok());
        assert_ne!(id, child_id);
        child_ids.push(child_id.to_owned());
    }
    assert_ne!(child_ids[0], child_ids[1]);
}
