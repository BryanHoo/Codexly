use tauri::AppHandle;
#[cfg(target_os = "linux")]
use tauri::Manager;
use tauri_plugin_autostart::ManagerExt;

use super::error::AppError;

#[tauri::command]
pub async fn enable_autostart(app: AppHandle) -> Result<(), AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(target_os = "windows")]
        let (key, command) = {
            use winreg::enums::{HKEY_CURRENT_USER, KEY_SET_VALUE};
            let executable = std::env::current_exe().map_err(|_| AppError::AutostartFailed)?;
            let key = winreg::RegKey::predef(HKEY_CURRENT_USER)
                .open_subkey_with_flags(
                    "Software\\Microsoft\\Windows\\CurrentVersion\\Run",
                    KEY_SET_VALUE,
                )
                .map_err(|_| AppError::AutostartFailed)?;
            (key, format!("\"{}\"", executable.display()))
        };
        app.autolaunch()
            .enable()
            .map_err(|_| AppError::AutostartFailed)?;
        // The plugin writes an unquoted Windows path; login must preserve spaces.
        #[cfg(target_os = "windows")]
        key.set_value(&app.package_info().name, &command)
            .map_err(|_| AppError::AutostartFailed)?;
        #[cfg(target_os = "linux")]
        repair_linux_entry(&app)?;
        Ok(())
    })
    .await
    .map_err(|_| AppError::AutostartFailed)?
}

#[cfg(target_os = "linux")]
fn desktop_executable(path: &str) -> Result<String, AppError> {
    if path
        .chars()
        .any(|character| character.is_control() || character == '=')
    {
        return Err(AppError::AutostartFailed);
    }
    // Desktop entries apply string escaping before Exec quoting and field codes.
    let command = format!(
        "\"{}\"",
        path.replace('\\', "\\\\\\\\")
            .replace('"', "\\\\\"")
            .replace('`', "\\\\`")
            .replace('$', "\\\\$")
            .replace('%', "%%")
    );
    // GLib checks the executable before expanding %% in Exec field codes.
    Ok(if path.contains('%') {
        format!("/usr/bin/env -- {command}")
    } else {
        command
    })
}

#[cfg(target_os = "linux")]
fn repair_linux_entry(app: &AppHandle) -> Result<(), AppError> {
    let executable = app
        .env()
        .appimage
        .map_or_else(std::env::current_exe, |path| {
            Ok(std::path::PathBuf::from(path))
        })
        .map_err(|_| AppError::AutostartFailed)?;
    let command = desktop_executable(executable.to_str().ok_or(AppError::AutostartFailed)?)?;
    let entry_path = app
        .path()
        .home_dir()
        .map_err(|_| AppError::AutostartFailed)?
        .join(".config/autostart")
        .join(format!("{}.desktop", app.package_info().name));
    let entry = std::fs::read_to_string(&entry_path).map_err(|_| AppError::AutostartFailed)?;
    let entry = entry
        .lines()
        .map(|line| {
            if line.starts_with("Exec=") {
                format!("Exec={command}")
            } else {
                line.to_owned()
            }
        })
        .collect::<Vec<_>>()
        .join("\n");
    std::fs::write(entry_path, entry).map_err(|_| AppError::AutostartFailed)
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::desktop_executable;
    use std::os::unix::fs::PermissionsExt;

    #[test]
    fn desktop_startup_should_launch_paths_with_reserved_characters() {
        let root = tempfile::tempdir().unwrap();
        let executable = root.path().join("startup space $ % ` \" \\ tool");
        std::fs::write(
            &executable,
            "#!/bin/sh\nprintf '%s' \"$0\" > \"$0.launched\"\n",
        )
        .unwrap();
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o700)).unwrap();
        let entry = root.path().join("startup.desktop");
        std::fs::write(&entry, format!(
            "[Desktop Entry]\nType=Application\nName=Autostart regression\nExec={}\nTerminal=false\n",
            desktop_executable(executable.to_str().unwrap()).unwrap(),
        )).unwrap();
        for command in ["desktop-file-validate", "gio"] {
            let mut process = std::process::Command::new(command);
            if command == "gio" {
                process.arg("launch");
            }
            let output = process.arg(&entry).output().unwrap();
            assert!(
                output.status.success(),
                "{command}: {}",
                String::from_utf8_lossy(&output.stderr)
            );
        }
        let marker = executable.with_file_name(format!(
            "{}.launched",
            executable.file_name().unwrap().to_str().unwrap()
        ));
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while !marker.exists() && std::time::Instant::now() < deadline {
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        assert_eq!(
            std::fs::read_to_string(marker).unwrap(),
            executable.to_str().unwrap()
        );
    }
}
