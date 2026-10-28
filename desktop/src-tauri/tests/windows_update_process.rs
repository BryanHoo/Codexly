#![cfg(windows)]

use std::{os::windows::process::CommandExt, path::Path, process::Stdio, time::Duration};
use tokio::{process::Command, time::timeout};

#[path = "../src/infrastructure/codex/process_job.rs"]
mod process_job;

const FIXTURE_DIRECTORY: &str = "CODEXLY_UPDATE_PROCESS_FIXTURE";

#[test]
fn update_owner_fixture() {
    let Some(directory) = std::env::var_os(FIXTURE_DIRECTORY) else {
        return;
    };
    let directory = std::path::PathBuf::from(directory);
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    runtime.block_on(async {
        let mut child = start_agent(&directory);
        let _job = process_job::attach(&mut child).await.unwrap();
        std::fs::write(directory.join("ready"), child.id().unwrap().to_string()).unwrap();
        timeout(Duration::from_secs(10), async {
            while !directory.join("exit").exists() {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        // 与 tauri-plugin-updater 的 Windows 安装分支一致，明确跳过所有 Rust 析构。
        std::process::exit(0);
    });
}

fn start_agent(directory: &Path) -> tokio::process::Child {
    let mut command = Command::new(directory.join("agent.exe"));
    command
        .args(["-t", "127.0.0.1"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    command.as_std_mut().creation_flags(0x0800_0000);
    command.spawn().unwrap()
}

#[tokio::test]
async fn updater_exit_should_release_runtime_binary_without_killing_another_installation() {
    let directory = tempfile::tempdir().unwrap();
    let other_directory = tempfile::tempdir().unwrap();
    let system_directory = Path::new(&std::env::var_os("SystemRoot").unwrap()).join("System32");
    for target in [directory.path(), other_directory.path()] {
        std::fs::copy(system_directory.join("PING.EXE"), target.join("agent.exe")).unwrap();
    }
    let mut other_agent = start_agent(other_directory.path());
    let mut owner_command = Command::new(std::env::current_exe().unwrap());
    owner_command
        .args(["--exact", "update_owner_fixture", "--nocapture"])
        .env(FIXTURE_DIRECTORY, directory.path())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    owner_command.as_std_mut().creation_flags(0x0800_0000);
    let mut owner = owner_command.spawn().unwrap();
    timeout(Duration::from_secs(10), async {
        while !directory.path().join("ready").exists() {
            assert!(owner.try_wait().unwrap().is_none(), "owner failed to start");
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    let binary = directory.path().join("agent.exe");
    assert!(
        std::fs::OpenOptions::new()
            .write(true)
            .open(&binary)
            .is_err()
    );
    std::fs::write(directory.path().join("exit"), b"update").unwrap();
    assert!(
        timeout(Duration::from_secs(5), owner.wait())
            .await
            .unwrap()
            .unwrap()
            .success()
    );
    timeout(Duration::from_secs(5), async {
        while std::fs::OpenOptions::new()
            .write(true)
            .open(&binary)
            .is_err()
        {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("updater must be able to replace the runtime after its owner exits");
    assert!(other_agent.try_wait().unwrap().is_none());
    other_agent.kill().await.unwrap();
}
