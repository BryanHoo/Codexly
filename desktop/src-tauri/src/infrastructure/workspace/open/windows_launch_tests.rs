use std::time::Duration;

use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde_json::Value;

use super::platform_command;

#[tokio::test]
async fn command_prompt_should_create_its_own_console_in_the_target_directory() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("CMD space & \u{6587}\u{4ef6}");
    tokio::fs::create_dir(&root).await.unwrap();
    let report_path = directory.path().join("console.json");
    let script = r#"
$ErrorActionPreference = 'Stop';
$ProgressPreference = 'SilentlyContinue';
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class CmdConsoleProbe { [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow(); [DllImport("kernel32.dll")] public static extern uint GetConsoleProcessList([Out] uint[] processes, uint length); }';
$ids = New-Object 'System.UInt32[]' 32;
$count = [CmdConsoleProbe]::GetConsoleProcessList($ids, $ids.Length);
$report = @{ cwd = (Get-Location).ProviderPath; console = [CmdConsoleProbe]::GetConsoleWindow().ToInt64(); processes = @($ids | Select-Object -First ([Math]::Min([int]$count, $ids.Length))) };
[IO.File]::WriteAllText($env:CODEXLY_CMD_PROBE_REPORT, (ConvertTo-Json -InputObject $report -Compress));
"#;
    let encoded = STANDARD.encode(
        script
            .encode_utf16()
            .flat_map(u16::to_le_bytes)
            .collect::<Vec<_>>(),
    );
    let target = std::fs::canonicalize(&root).unwrap();
    let mut command = platform_command("command-prompt", &target).unwrap();
    command
        .arg(format!(
            "powershell.exe -NoProfile -NonInteractive -EncodedCommand {encoded} & exit"
        ))
        .env("CODEXLY_CMD_PROBE_REPORT", &report_path)
        .kill_on_drop(true);
    let mut child = command.spawn().unwrap();
    let command_prompt_pid = child.id().unwrap();
    let report = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            if let Ok(report) = tokio::fs::read_to_string(&report_path).await
                && let Ok(report) = serde_json::from_str::<Value>(&report)
            {
                break report;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await;
    let _ = child.kill().await;
    let _ = child.wait().await;
    let report = report.expect("CMD should execute the probe in its new console");
    assert_ne!(report["console"].as_i64().unwrap(), 0);
    assert!(
        report["processes"]
            .as_array()
            .unwrap()
            .contains(&Value::from(command_prompt_pid)),
        "the probe must run in the CMD console"
    );
    assert!(
        !report["processes"]
            .as_array()
            .unwrap()
            .contains(&Value::from(std::process::id())),
        "CMD must not inherit the application's console"
    );
    assert_eq!(
        std::fs::canonicalize(report["cwd"].as_str().unwrap()).unwrap(),
        std::fs::canonicalize(root).unwrap()
    );
}

#[test]
fn command_prompt_for_a_file_should_use_its_parent_directory() {
    let directory = tempfile::tempdir().unwrap();
    let file = directory.path().join("README.md");
    std::fs::write(&file, "test").unwrap();
    let command = platform_command("command-prompt", &file).unwrap();
    assert_eq!(command.as_std().get_current_dir(), Some(directory.path()));
}
