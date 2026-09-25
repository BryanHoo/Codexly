use std::path::Path;

use serde::Serialize;
use tokio::process::Command;

use super::path_guard::WorkspaceError;

#[cfg(any(target_os = "linux", target_os = "windows", test))]
mod catalog;

#[cfg(test)]
#[path = "open/tests.rs"]
mod cross_platform_tests;

#[cfg(test)]
mod completion_tests {
    use super::should_wait_for_exit;

    #[test]
    fn windows_explorer_should_not_wait_for_exit_status() {
        assert!(!should_wait_for_exit("windows", "system-default"));
        assert!(!should_wait_for_exit("windows", "explorer"));
        assert!(should_wait_for_exit("windows", "windows-terminal"));
        assert!(should_wait_for_exit("windows", "visual-studio-code"));
        assert!(should_wait_for_exit("macos", "system-default"));
    }
}

#[derive(Clone, Copy, Debug, Serialize)]
pub struct OpenApp {
    pub id: &'static str,
    pub kind: &'static str,
    pub name: &'static str,
}

#[cfg(target_os = "macos")]
#[derive(Clone, Copy)]
struct MacApp {
    app: OpenApp,
    bundle_path: &'static str,
    open_name: &'static str,
}

#[cfg(target_os = "macos")]
const MAC_APPS: [MacApp; 9] = [
    MacApp {
        app: OpenApp {
            id: "finder",
            kind: "file-manager",
            name: "Finder",
        },
        bundle_path: "/System/Library/CoreServices/Finder.app",
        open_name: "Finder",
    },
    MacApp {
        app: OpenApp {
            id: "terminal",
            kind: "terminal",
            name: "Terminal",
        },
        bundle_path: "/System/Applications/Utilities/Terminal.app",
        open_name: "Terminal",
    },
    MacApp {
        app: OpenApp {
            id: "ghostty",
            kind: "terminal",
            name: "Ghostty",
        },
        bundle_path: "/Applications/Ghostty.app",
        open_name: "Ghostty",
    },
    MacApp {
        app: OpenApp {
            id: "iterm2",
            kind: "terminal",
            name: "iTerm2",
        },
        bundle_path: "/Applications/iTerm.app",
        open_name: "iTerm",
    },
    MacApp {
        app: OpenApp {
            id: "visual-studio-code",
            kind: "editor",
            name: "Visual Studio Code",
        },
        bundle_path: "/Applications/Visual Studio Code.app",
        open_name: "Visual Studio Code",
    },
    MacApp {
        app: OpenApp {
            id: "zed",
            kind: "editor",
            name: "Zed",
        },
        bundle_path: "/Applications/Zed.app",
        open_name: "Zed",
    },
    MacApp {
        app: OpenApp {
            id: "windsurf",
            kind: "editor",
            name: "Windsurf",
        },
        bundle_path: "/Applications/Windsurf.app",
        open_name: "Windsurf",
    },
    MacApp {
        app: OpenApp {
            id: "xcode",
            kind: "editor",
            name: "Xcode",
        },
        bundle_path: "/Applications/Xcode.app",
        open_name: "Xcode",
    },
    MacApp {
        app: OpenApp {
            id: "android-studio",
            kind: "editor",
            name: "Android Studio",
        },
        bundle_path: "/Applications/Android Studio.app",
        open_name: "Android Studio",
    },
];

#[cfg(target_os = "macos")]
pub fn platform_apps() -> (&'static str, Vec<OpenApp>) {
    let home = std::env::var_os("HOME").map(std::path::PathBuf::from);
    (
        "darwin",
        macos_apps_for_paths(home.as_deref(), Path::exists),
    )
}

#[cfg(target_os = "linux")]
pub fn platform_apps() -> (&'static str, Vec<OpenApp>) {
    ("linux", catalog::installed_apps("linux"))
}

#[cfg(target_os = "windows")]
pub fn platform_apps() -> (&'static str, Vec<OpenApp>) {
    ("win32", catalog::installed_apps("windows"))
}

#[cfg(target_os = "macos")]
fn macos_apps_for_paths(home: Option<&Path>, exists: impl Fn(&Path) -> bool) -> Vec<OpenApp> {
    let mut apps = vec![OpenApp {
        id: "system-default",
        kind: "system-default",
        name: "默认应用",
    }];
    apps.extend(MAC_APPS.into_iter().filter_map(|candidate| {
        let global = exists(Path::new(candidate.bundle_path));
        let user = home.is_some_and(|home| {
            Path::new(candidate.bundle_path)
                .file_name()
                .is_some_and(|name| exists(&home.join("Applications").join(name)))
        });
        (global || user).then_some(candidate.app)
    }));
    apps
}

pub async fn open_path(app_id: &str, path: &Path) -> Result<(), WorkspaceError> {
    if !path.exists() {
        return Err(WorkspaceError::InvalidPath);
    }
    let mut command = platform_command(app_id, path)?;
    if !should_wait_for_exit(std::env::consts::OS, app_id) {
        // Explorer 会把请求转交给现有 shell，进程退出码不能表示窗口是否打开。
        command.spawn()?;
        return Ok(());
    }
    let status = command.status().await?;
    status
        .success()
        .then_some(())
        .ok_or(WorkspaceError::InvalidPath)
}

pub async fn reveal_path(path: &Path) -> Result<(), WorkspaceError> {
    if !path.is_file() {
        return Err(WorkspaceError::InvalidPath);
    }
    let mut command = reveal_command(path)?;
    if cfg!(target_os = "windows") {
        command.spawn()?;
        return Ok(());
    }
    command
        .status()
        .await?
        .success()
        .then_some(())
        .ok_or(WorkspaceError::InvalidPath)
}

#[cfg(target_os = "macos")]
fn reveal_command(path: &Path) -> Result<Command, WorkspaceError> {
    let mut command = Command::new("open");
    command.arg("-R").arg(path);
    Ok(command)
}

#[cfg(target_os = "linux")]
fn reveal_command(path: &Path) -> Result<Command, WorkspaceError> {
    let mut command = Command::new("xdg-open");
    command.arg(path.parent().ok_or(WorkspaceError::InvalidPath)?);
    Ok(command)
}

#[cfg(target_os = "windows")]
fn reveal_command(path: &Path) -> Result<Command, WorkspaceError> {
    let mut command = Command::new("explorer");
    command.arg("/select,").arg(path);
    Ok(command)
}

fn should_wait_for_exit(platform: &str, app_id: &str) -> bool {
    platform != "windows" || !matches!(app_id, "system-default" | "explorer")
}

#[cfg(target_os = "macos")]
fn platform_command(app_id: &str, path: &Path) -> Result<Command, WorkspaceError> {
    let mut command = Command::new("open");
    match app_id {
        "system-default" => {}
        "finder" => {
            command.arg("-R");
        }
        _ => {
            let app = MAC_APPS
                .iter()
                .find(|candidate| candidate.app.id == app_id)
                .ok_or(WorkspaceError::InvalidPath)?;
            command.args(["-a", app.open_name]);
        }
    }
    command.arg(path);
    Ok(command)
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use std::collections::HashSet;

    use super::macos_apps_for_paths;

    #[test]
    fn macos_apps_should_only_include_installed_development_tools() {
        let installed = HashSet::from([
            "/Applications/Zed.app",
            "/Applications/Ghostty.app",
            "/Applications/iTerm.app",
        ]);
        let apps = macos_apps_for_paths(None, |path| {
            path.to_str().is_some_and(|path| installed.contains(path))
        });
        let ids: Vec<_> = apps.iter().map(|app| app.id).collect();

        assert!(ids.contains(&"zed"));
        assert!(ids.contains(&"ghostty"));
        assert!(ids.contains(&"iterm2"));
        assert!(!ids.contains(&"visual-studio-code"));
    }
}

#[cfg(target_os = "linux")]
fn platform_command(app_id: &str, path: &Path) -> Result<Command, WorkspaceError> {
    let program = catalog::launch_program("linux", app_id).ok_or(WorkspaceError::InvalidPath)?;
    let mut command = Command::new(program);
    match app_id {
        "terminal" | "ghostty" => {
            // 终端继承目标目录，避免把目录误解析为待执行命令。
            command.current_dir(path);
        }
        "gnome-terminal" | "xfce-terminal" => {
            command.arg("--working-directory").arg(path);
        }
        "konsole" => {
            command.arg("--workdir").arg(path);
        }
        _ => {
            command.arg(path);
        }
    }
    Ok(command)
}

#[cfg(target_os = "windows")]
fn platform_command(app_id: &str, path: &Path) -> Result<Command, WorkspaceError> {
    let program = catalog::launch_program("windows", app_id).ok_or(WorkspaceError::InvalidPath)?;
    let mut command = Command::new(program);
    match app_id {
        "windows-terminal" => {
            command.arg("-d").arg(path);
        }
        "command-prompt" => {
            command.args(["/K", "cd", "/D"]).arg(path);
        }
        _ => {
            command.arg(path);
        }
    }
    Ok(command)
}

#[cfg(all(test, target_os = "linux"))]
mod linux_tests {
    use std::{ffi::OsStr, path::Path};

    use super::platform_command;

    #[test]
    fn linux_terminals_should_use_their_working_directory_arguments() {
        let path = Path::new("/tmp/project");

        for (app_id, option) in [
            ("gnome-terminal", "--working-directory"),
            ("konsole", "--workdir"),
            ("xfce-terminal", "--working-directory"),
        ] {
            let command = platform_command(app_id, path).expect("terminal command should build");
            let args: Vec<_> = command.as_std().get_args().collect();
            assert_eq!(args, [OsStr::new(option), path.as_os_str()]);
        }
    }

    #[test]
    fn generic_linux_terminal_should_inherit_the_requested_directory() {
        let path = Path::new("/tmp/project");
        let command = platform_command("terminal", path).expect("terminal command should build");

        assert_eq!(command.as_std().get_current_dir(), Some(path));
        assert_eq!(command.as_std().get_args().count(), 0);
    }
}

#[cfg(all(test, target_os = "windows"))]
mod windows_tests {
    use std::{ffi::OsStr, fs, path::Path};

    use super::{catalog::executable_in_directory, platform_command};

    #[test]
    fn windows_terminal_should_use_starting_directory_argument() {
        let path = Path::new(r"C:\workspace\project");
        let command =
            platform_command("windows-terminal", path).expect("terminal command should build");
        let args: Vec<_> = command.as_std().get_args().collect();

        assert_eq!(args, [OsStr::new("-d"), path.as_os_str()]);
    }

    #[test]
    fn windows_executable_detection_should_find_cmd_shims() {
        let directory = std::env::temp_dir().join(format!(
            "codeagent-open-command-test-{}",
            std::process::id()
        ));
        fs::create_dir_all(&directory).expect("test directory should be created");
        let shim = directory.join("code.cmd");
        fs::write(&shim, "@echo off\r\n").expect("cmd shim should be created");

        assert_eq!(executable_in_directory(&directory, "code"), Some(shim));

        fs::remove_dir_all(directory).expect("test directory should be removed");
    }
}
