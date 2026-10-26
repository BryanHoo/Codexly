//! 仅在启动握手失败后执行轻量配置诊断，不进入正常启动路径或注销恢复路径。

use super::process::{ProcessError, background_process_command, read_limited};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{ffi::OsStr, fmt, process::Stdio, time::Duration};
use thiserror::Error;
use tokio::{process::Command, time::timeout};

const OUTPUT_LIMIT: usize = 1_048_576;
const PROBE_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Deserialize)]
pub(super) struct StartupConfigError {
    code: i64,
    message: String,
    pub(super) data: Option<Value>,
}

impl fmt::Display for StartupConfigError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Codex 配置预检失败 ({}): {}", self.code, self.message)?;
        if let Some(data) = &self.data {
            if let Some(reason) = data["reason"].as_str() {
                write!(f, " [{reason}]")?;
            }
            if let Some(path) = data["filePath"].as_str() {
                write!(f, " ({path}")?;
                // 上游配置诊断已使用 1 起始行列，直接保留以便编辑器定位。
                if let Some(line) = data["line"].as_u64().filter(|line| *line > 0) {
                    write!(f, ":{line}")?;
                    if let Some(column) = data["column"].as_u64().filter(|column| *column > 0) {
                        write!(f, ":{column}")?;
                    }
                }
                write!(f, ")")?;
            }
            if let Some(detail) = data["detail"].as_str() {
                write!(f, ": {detail}")?;
            }
            if data["action"].as_str() == Some("relogin") {
                write!(f, "；请重新登录 Codex 后重试")?;
            }
        }
        Ok(())
    }
}

#[derive(Debug, Error)]
pub(super) enum StartupConfigProbeError {
    #[error("{0}")]
    Configuration(StartupConfigError),
    #[error("Codex 配置预检输出无效或进程异常退出")]
    InvalidOutput,
    #[error("Codex 配置预检执行失败")]
    Io(#[from] std::io::Error),
    #[error("Codex 配置预检超时")]
    Timeout,
}

pub(super) fn build_startup_config_command(
    program: &OsStr,
    runtime_path: Option<&OsStr>,
) -> Command {
    let mut command = background_process_command(program);
    // 沿用桌面正式握手的历史客户端名 codeagent，保持组织策略请求身份一致。
    command
        .args([
            "app-server",
            "--enable",
            "plugins",
            "--print-startup-config",
            "--startup-client-info",
        ])
        .arg(
            json!({"name":"codeagent", "title":"Codexly", "version":env!("CARGO_PKG_VERSION")})
                .to_string(),
        );
    if let Some(path) = runtime_path {
        command.env("PATH", path);
    }
    // cwd、CODEX_HOME 继承正式服务的宿主环境；不使用 --listen 或 --startup-sign-out。
    command
}

pub(super) fn parse_startup_config(
    output: &[u8],
    success: bool,
) -> Result<(), StartupConfigProbeError> {
    let value: Value =
        serde_json::from_slice(output).map_err(|_| StartupConfigProbeError::InvalidOutput)?;
    let object = value
        .as_object()
        .ok_or(StartupConfigProbeError::InvalidOutput)?;
    if let Some(error) = object.get("error") {
        if object.contains_key("appServerVersion") || object.contains_key("configRequirements") {
            return Err(StartupConfigProbeError::InvalidOutput);
        }
        let error = serde_json::from_value(error.clone())
            .map_err(|_| StartupConfigProbeError::InvalidOutput)?;
        return Err(StartupConfigProbeError::Configuration(error));
    }
    let requirements = &value["configRequirements"];
    if !success
        || !value["appServerVersion"]
            .as_str()
            .is_some_and(|version| !version.is_empty())
        || !requirements.is_object()
        || !requirements
            .get("requirements")
            .is_some_and(|value| value.is_null() || value.is_object())
        || !requirements
            .get("supportsIndependentSpeedModes")
            .is_none_or(|value| value.is_null() || value.is_boolean())
    {
        return Err(StartupConfigProbeError::InvalidOutput);
    }
    Ok(())
}

pub(super) async fn probe_command(
    mut command: Command,
    deadline: Duration,
) -> Result<(), StartupConfigProbeError> {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let mut child = command.spawn()?;
    let stdout = child
        .stdout
        .take()
        .ok_or(StartupConfigProbeError::InvalidOutput)?;
    let stderr = child
        .stderr
        .take()
        .ok_or(StartupConfigProbeError::InvalidOutput)?;
    // 同时排空两条管道，每条最多读取 1 MiB；超时、超限或取消均终止子进程。
    let result = timeout(deadline, async {
        tokio::try_join!(
            child.wait(),
            read_limited(stdout, OUTPUT_LIMIT),
            read_limited(stderr, OUTPUT_LIMIT)
        )
    })
    .await;
    match result {
        Ok(Ok((status, stdout, _))) => parse_startup_config(&stdout, status.success()),
        Ok(Err(error)) => {
            let _ = child.kill().await;
            Err(error.into())
        }
        Err(_) => {
            let _ = child.kill().await;
            Err(StartupConfigProbeError::Timeout)
        }
    }
}

pub(super) async fn diagnose_startup_failure(
    program: &OsStr,
    runtime_path: Option<&OsStr>,
    original: ProcessError,
) -> ProcessError {
    match probe_command(
        build_startup_config_command(program, runtime_path),
        PROBE_TIMEOUT,
    )
    .await
    {
        Err(StartupConfigProbeError::Configuration(error)) => ProcessError::StartupConfiguration {
            detail: error.to_string(),
            source: Box::new(original),
        },
        // 诊断失败不覆盖真正的启动原因；详细配置错误经已有错误链进入脱敏日志。
        _ => original,
    }
}
