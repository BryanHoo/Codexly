use std::ffi::OsString;

#[cfg(unix)]
use std::{collections::HashSet, env, path::Path, process::Stdio, time::Duration};
#[cfg(unix)]
use tokio::{io::AsyncReadExt, process::Command, time::timeout};

#[cfg(unix)]
use super::process::executable_path;

#[cfg(unix)]
const SHELL_PATH_TIMEOUT: Duration = Duration::from_secs(3);
#[cfg(unix)]
const SHELL_PATH_OUTPUT_LIMIT: usize = 64 * 1024;
#[cfg(any(unix, test))]
const SHELL_PATH_START: u8 = 0x1e;
#[cfg(any(unix, test))]
const SHELL_PATH_END: u8 = 0x1f;
#[cfg(unix)]
const SHELL_PATH_PROBE: &str = r#"printf '\036%s\037' "$PATH""#;

#[cfg(unix)]
pub(super) async fn resolve_runtime_path() -> Option<OsString> {
    for shell in login_shell_candidates() {
        if let Some(path) = probe_login_shell_path(&shell).await {
            return merge_unix_paths(Some(path));
        }
    }
    merge_unix_paths(None)
}

#[cfg(unix)]
fn merge_unix_paths(shell_path: Option<OsString>) -> Option<OsString> {
    merge_unix_path_values(shell_path, env::var_os("PATH"))
}

#[cfg(unix)]
fn merge_unix_path_values(
    shell_path: Option<OsString>,
    process_path: Option<OsString>,
) -> Option<OsString> {
    let mut seen = HashSet::new();
    let directories = [shell_path, process_path]
        .into_iter()
        .flatten()
        .flat_map(|path| env::split_paths(&path).collect::<Vec<_>>())
        .filter(|directory| seen.insert(directory.clone()));
    env::join_paths(directories).ok()
}

#[cfg(unix)]
fn login_shell_candidates() -> Vec<std::path::PathBuf> {
    let mut shells = Vec::new();
    if let Some(shell) = env::var_os("SHELL").and_then(|shell| executable_path(Path::new(&shell))) {
        shells.push(shell);
    }
    let fallback = if env::consts::OS == "macos" {
        Path::new("/bin/zsh")
    } else {
        Path::new("/bin/bash")
    };
    if let Some(fallback) = executable_path(fallback)
        && !shells.contains(&fallback)
    {
        shells.push(fallback);
    }
    shells
}

#[cfg(unix)]
async fn probe_login_shell_path(shell: &Path) -> Option<OsString> {
    let mut child = Command::new(shell)
        .args(["-ilc", SHELL_PATH_PROBE])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .ok()?;
    let stdout = child.stdout.take()?;
    let result = timeout(SHELL_PATH_TIMEOUT, async {
        let mut output = Vec::new();
        let mut stdout = stdout.take(SHELL_PATH_OUTPUT_LIMIT as u64 + 1);
        let (status, read) = tokio::join!(child.wait(), stdout.read_to_end(&mut output));
        let status = status.ok()?;
        read.ok()?;
        (output.len() <= SHELL_PATH_OUTPUT_LIMIT).then_some((status, output))
    })
    .await;
    let (status, output) = match result {
        Ok(Some(result)) => result,
        Ok(None) => return None,
        Err(_) => {
            let _ = child.kill().await;
            return None;
        }
    };
    status
        .success()
        .then(|| parse_shell_path_output(&output))
        .flatten()
}

#[cfg(windows)]
pub(super) async fn resolve_runtime_path() -> Option<OsString> {
    use std::{env, path::PathBuf};

    use winreg::{
        RegKey,
        enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE},
    };

    let mut directories = Vec::new();
    extend_path(&mut directories, env::var_os("PATH"));
    let machine = RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey(r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment")
        .ok()
        .and_then(|key| key.get_value::<OsString, _>("Path").ok());
    let user = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey("Environment")
        .ok()
        .and_then(|key| key.get_value::<OsString, _>("Path").ok());
    extend_path(&mut directories, machine.and_then(expand_registry_value));
    extend_path(&mut directories, user.and_then(expand_registry_value));

    // GUI 进程可能早于 Node 安装启动，补充默认目录保证 npm shim 能立即找到 node.exe。
    for (variable, suffix) in [
        ("APPDATA", "npm"),
        ("ProgramFiles", "nodejs"),
        ("ProgramFiles(x86)", "nodejs"),
        ("LOCALAPPDATA", "Programs/nodejs"),
    ] {
        if let Some(root) = env::var_os(variable) {
            directories.push(PathBuf::from(root).join(suffix));
        }
    }
    env::join_paths(directories).ok()
}

#[cfg(windows)]
fn extend_path(directories: &mut Vec<std::path::PathBuf>, value: Option<OsString>) {
    if let Some(value) = value {
        directories.extend(std::env::split_paths(&value));
    }
}

#[cfg(windows)]
fn expand_registry_value(value: OsString) -> Option<OsString> {
    windows_process_platform::expand_environment_strings(&value)
}

#[cfg(not(any(unix, windows)))]
pub(super) async fn resolve_runtime_path() -> Option<OsString> {
    None
}

#[cfg(any(unix, test))]
fn parse_shell_path_output(output: &[u8]) -> Option<OsString> {
    // shell 初始化可能输出版本管理器提示，仅提取控制字符标记之间的 PATH。
    let start = output.iter().rposition(|byte| *byte == SHELL_PATH_START)? + 1;
    let end = output[start..]
        .iter()
        .position(|byte| *byte == SHELL_PATH_END)?
        + start;
    let path = std::str::from_utf8(&output[start..end]).ok()?;
    (!path.is_empty()).then(|| OsString::from(path))
}

#[cfg(test)]
mod tests {
    use std::ffi::OsString;

    #[cfg(unix)]
    use super::merge_unix_path_values;
    use super::parse_shell_path_output;

    #[test]
    fn shell_path_should_ignore_shell_startup_output() {
        assert_eq!(
            parse_shell_path_output(b"Using Node v24.19.0\n\x1e/shell/node/bin:/usr/bin\x1f"),
            Some(OsString::from("/shell/node/bin:/usr/bin"))
        );
        assert_eq!(parse_shell_path_output(b"missing markers"), None);
    }

    #[cfg(unix)]
    #[test]
    fn runtime_path_should_merge_shell_and_process_directories() {
        assert_eq!(
            merge_unix_path_values(
                Some(OsString::from("/shell/bin:/shared/bin")),
                Some(OsString::from("/process/bin:/shared/bin")),
            ),
            Some(OsString::from("/shell/bin:/shared/bin:/process/bin"))
        );
    }
}
