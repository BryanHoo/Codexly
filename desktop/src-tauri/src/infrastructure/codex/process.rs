use std::{
    ffi::OsStr,
    path::{Path, PathBuf},
    process::Stdio,
    sync::Arc,
    time::Duration,
};

use thiserror::Error;
use tokio::{
    io::{self, AsyncRead, AsyncReadExt},
    process::{Child, Command},
    task::JoinHandle,
    time::timeout,
};

use super::connection::{AppServerConnection, ConnectionError};
use super::runtime_manager::{RuntimeDiscoveryError, find_compatible_codex_binary};
use super::stderr::spawn_codex_stderr_tasks;

pub const SUPPORTED_CODEX_VERSION: &str = "0.156.0";
const STARTUP_TIMEOUT: Duration = Duration::from_secs(10);
const VERSION_PROBE_TIMEOUT: Duration = Duration::from_secs(3);
const VERSION_OUTPUT_LIMIT: usize = 4 * 1024;
#[cfg(any(windows, test))]
const WINDOWS_CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Error)]
pub enum ProcessError {
    #[error("failed to spawn codex app-server")]
    Spawn(#[source] std::io::Error),
    #[error("failed to probe Codex version")]
    VersionProbe(#[source] std::io::Error),
    #[error("Codex version probe timed out")]
    VersionProbeTimeout,
    #[error("Codex version output exceeded the limit")]
    VersionOutputTooLarge,
    #[error("unsupported Codex version; expected 0.156.0")]
    UnsupportedVersion,
    #[error(transparent)]
    RuntimeDiscovery(#[from] RuntimeDiscoveryError),
    #[error("codex app-server did not expose required stdio pipes")]
    MissingPipe,
    #[error("codex app-server handshake failed")]
    Handshake(#[source] ConnectionError),
    #[error("codex app-server returned incomplete runtime metadata")]
    InvalidMetadata,
}

pub struct CodexProcess {
    _child: Child,
    binary_path: PathBuf,
    connection: Arc<AppServerConnection>,
    codex_home: PathBuf,
    stderr_task: JoinHandle<()>,
    stderr_writer_task: JoinHandle<()>,
    version: String,
}

impl CodexProcess {
    pub async fn start(app_data: &Path) -> Result<Self, ProcessError> {
        let process = Self::start_once(app_data).await?;
        if super::auth::ensure_custom_model_discovery(&process.connection)
            .await
            .map_err(ProcessError::Handshake)?
        {
            // Provider 与模型管理器在握手时固定；配置迁移后必须重新创建进程。
            drop(process);
            return Self::start_once(app_data).await;
        }
        Ok(process)
    }

    async fn start_once(app_data: &Path) -> Result<Self, ProcessError> {
        let (program, version, runtime_path) = find_compatible_codex_binary(app_data).await?;
        let mut child = build_app_server_command(program.as_os_str(), runtime_path.as_deref())
            .spawn()
            .map_err(ProcessError::Spawn)?;
        let stdin = child.stdin.take().ok_or(ProcessError::MissingPipe)?;
        let stdout = child.stdout.take().ok_or(ProcessError::MissingPipe)?;
        let stderr = child.stderr.take().ok_or(ProcessError::MissingPipe)?;

        // stderr 读取与磁盘写入通过有界队列隔离，避免日志反压阻塞协议进程。
        let connection = Arc::new(AppServerConnection::with_image_store(
            stdout, stdin, app_data,
        ));
        let (stderr_task, stderr_writer_task) =
            spawn_codex_stderr_tasks(stderr, connection.diagnostic_seq());
        let metadata = connection
            .initialize(STARTUP_TIMEOUT)
            .await
            .map_err(ProcessError::Handshake)?;

        let codex_home = PathBuf::from(&metadata.codex_home);
        if metadata.user_agent.is_empty()
            || !codex_home.is_absolute()
            || metadata.platform_family.is_empty()
            || metadata.platform_os.is_empty()
        {
            return Err(ProcessError::InvalidMetadata);
        }

        Ok(Self {
            _child: child,
            binary_path: program,
            connection,
            codex_home,
            stderr_task,
            stderr_writer_task,
            version,
        })
    }

    pub fn connection(&self) -> Arc<AppServerConnection> {
        Arc::clone(&self.connection)
    }

    pub fn version(&self) -> &str {
        &self.version
    }

    pub fn codex_home(&self) -> &Path {
        &self.codex_home
    }

    #[allow(dead_code)]
    pub fn binary_path(&self) -> &Path {
        &self.binary_path
    }
}

impl Drop for CodexProcess {
    fn drop(&mut self) {
        self.stderr_task.abort();
        self.stderr_writer_task.abort();
    }
}

#[cfg(unix)]
pub(super) fn executable_path(path: &Path) -> Option<PathBuf> {
    let canonical = path.canonicalize().ok()?;
    let metadata = canonical.metadata().ok()?;
    if !metadata.is_file() {
        return None;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if metadata.permissions().mode() & 0o111 == 0 {
            return None;
        }
    }
    Some(canonical)
}

pub(super) async fn probe_codex_version(
    program: &Path,
    runtime_path: Option<&OsStr>,
) -> Result<String, ProcessError> {
    probe_codex_version_with_timeout(program, runtime_path, VERSION_PROBE_TIMEOUT).await
}

pub(super) async fn probe_codex_version_with_timeout(
    program: &Path,
    runtime_path: Option<&OsStr>,
    probe_timeout: Duration,
) -> Result<String, ProcessError> {
    let mut command = build_version_probe_command(program.as_os_str(), runtime_path);
    command
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let mut child = command.spawn().map_err(ProcessError::VersionProbe)?;
    let stdout = child.stdout.take().ok_or(ProcessError::MissingPipe)?;
    let stderr = child.stderr.take().ok_or(ProcessError::MissingPipe)?;
    let result = timeout(probe_timeout, async {
        tokio::try_join!(
            child.wait(),
            read_limited(stdout, VERSION_OUTPUT_LIMIT),
            read_limited(stderr, VERSION_OUTPUT_LIMIT)
        )
    })
    .await;
    let (status, stdout, _stderr) = match result {
        Ok(result) => result.map_err(ProcessError::VersionProbe)?,
        Err(_) => {
            let _ = child.kill().await;
            return Err(ProcessError::VersionProbeTimeout);
        }
    };
    if !status.success() {
        return Err(ProcessError::UnsupportedVersion);
    }
    let output = std::str::from_utf8(&stdout).map_err(|_| ProcessError::UnsupportedVersion)?;
    parse_codex_cli_version(output)
        .map(str::to_owned)
        .ok_or(ProcessError::UnsupportedVersion)
}

async fn read_limited<R: AsyncRead + Unpin>(reader: R, limit: usize) -> Result<Vec<u8>, io::Error> {
    let mut output = Vec::with_capacity(limit.min(256));
    reader
        .take(u64::try_from(limit).unwrap_or(u64::MAX) + 1)
        .read_to_end(&mut output)
        .await?;
    if output.len() > limit {
        return Err(io::Error::other(ProcessError::VersionOutputTooLarge));
    }
    Ok(output)
}

#[cfg(test)]
fn parse_codex_version(output: &str) -> Option<&str> {
    let version = parse_codex_cli_version(output)?;
    is_compatible_codex_version(version).then_some(version)
}

pub(super) fn is_compatible_codex_version(version: &str) -> bool {
    // 实验协议只接受已验证的精确版本；复用唯一常量，避免重复版本源和解析开销。
    version == SUPPORTED_CODEX_VERSION
}

fn parse_codex_cli_version(output: &str) -> Option<&str> {
    let mut parts = output.trim().split_ascii_whitespace();
    match (parts.next(), parts.next(), parts.next()) {
        (Some("codex-cli"), Some(version), None)
            if version.len() <= 64
                && version.bytes().all(|byte| {
                    byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'+')
                }) =>
        {
            Some(version)
        }
        _ => None,
    }
}

fn build_app_server_command(program: &OsStr, runtime_path: Option<&OsStr>) -> Command {
    let mut command = background_process_command(program);
    // 不设置 CODEX_HOME，让官方逻辑继承用户配置或回退到默认 ~/.codex。
    command
        .args(["app-server", "--enable", "plugins", "--listen", "stdio://"])
        .env("LOG_FORMAT", "json")
        .env("RUST_LOG", "warn")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    if let Some(runtime_path) = runtime_path {
        // Codex 0.152 会从自身环境复制 PATH，再用它解析 npx 等 stdio MCP 命令。
        command.env("PATH", runtime_path);
    }
    #[cfg(target_os = "macos")]
    configure_packaged_shell(&mut command, macos_panel_activation::macos_major_version());
    command
}

#[cfg(any(target_os = "macos", test))]
fn configure_packaged_shell(command: &mut Command, macos_major: isize) {
    // 官方 0.156.0 内置 zsh 的 Mach-O 最低系统为 15.0；旧系统保留标准 shell 执行路径。
    // 按宿主能力选择，而非按 Legacy 标志选择，让升级后的系统自动使用原生实现。
    if macos_major < 15 {
        command.args(["--disable", "shell_zsh_fork"]);
    }
}

fn build_version_probe_command(program: &OsStr, runtime_path: Option<&OsStr>) -> Command {
    let mut command = background_process_command(program);
    if let Some(runtime_path) = runtime_path {
        // npm 安装的 codex 可能通过 /usr/bin/env 启动 node，探测时必须复用 shell PATH。
        command.env("PATH", runtime_path);
    }
    command
}

pub(super) fn background_process_command(program: &OsStr) -> Command {
    configure_background_process_command(Command::new(program))
}

#[cfg(windows)]
fn configure_background_process_command(mut command: Command) -> Command {
    use std::os::windows::process::CommandExt;

    // Windows 11 24H2+ 的应用入口会创建无窗口控制台，Codex 及其后代共同继承它。
    // 旧系统无法分配这种控制台时，至少禁止直接子进程创建窗口。
    command
        .as_std_mut()
        .creation_flags(background_process_creation_flags(
            std::env::consts::OS,
            windows_process_platform::has_hidden_console(),
        ));
    command
}

#[cfg(not(windows))]
fn configure_background_process_command(command: Command) -> Command {
    command
}

#[cfg(any(windows, test))]
fn background_process_creation_flags(os: &str, has_hidden_console: bool) -> u32 {
    if os == "windows" && !has_hidden_console {
        WINDOWS_CREATE_NO_WINDOW
    } else {
        0
    }
}

#[cfg(test)]
#[path = "process_tests.rs"]
mod tests;
