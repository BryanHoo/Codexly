use crate::domain::project_terminal::TerminalError;
use portable_pty::CommandBuilder;
use std::{
    path::{Path, PathBuf},
    sync::OnceLock,
};

static SHELL: OnceLock<PathBuf> = OnceLock::new();

pub(super) fn command_for_root(root: &Path) -> Result<CommandBuilder, TerminalError> {
    if !root.is_absolute() || !root.is_dir() {
        return Err(TerminalError::RootInvalid);
    }
    let shell = SHELL.get_or_init(resolve_shell);
    if !shell.is_absolute() || !shell.is_file() {
        return Err(TerminalError::SpawnFailed);
    }
    let mut command = CommandBuilder::new(shell);
    let name = shell
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    // 登录与交互参数按 shell 选择；从 Finder 启动时由登录 profile 补齐用户 PATH。
    match name.as_str() {
        "bash" => command.args(["--login", "-i"]),
        "zsh" | "fish" => command.args(["-l", "-i"]),
        "sh" | "dash" | "ksh" => command.args(["-i"]),
        "csh" | "tcsh" => command.args(["-l"]),
        "pwsh.exe" | "powershell.exe" => command.args(["-NoLogo"]),
        "cmd.exe" => command.args(["/D"]),
        _ => {}
    }
    command.cwd(root);
    #[cfg(unix)]
    command.env("TERM", "xterm-256color");
    Ok(command)
}

#[cfg(unix)]
fn resolve_shell() -> PathBuf {
    use std::os::unix::fs::PermissionsExt;
    let candidate = PathBuf::from(CommandBuilder::new_default_prog().get_shell());
    if candidate.is_absolute()
        && candidate
            .metadata()
            .is_ok_and(|metadata| metadata.is_file() && metadata.permissions().mode() & 0o111 != 0)
    {
        candidate
    } else {
        PathBuf::from("/bin/sh")
    }
}

#[cfg(windows)]
fn resolve_shell() -> PathBuf {
    let path = std::env::var_os("PATH").unwrap_or_default();
    for name in ["pwsh.exe", "powershell.exe"] {
        for directory in std::env::split_paths(&path) {
            let candidate = directory.join(name);
            if candidate.is_absolute() && candidate.is_file() {
                return candidate;
            }
        }
    }
    let system = std::env::var_os("SystemRoot")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\Windows"));
    let powershell = system.join(r"System32\WindowsPowerShell\v1.0\powershell.exe");
    if powershell.is_file() {
        powershell
    } else {
        system.join(r"System32\cmd.exe")
    }
}
