use std::path::{Path, PathBuf};

use super::OpenApp;

#[derive(Clone, Debug)]
pub(super) struct AppCandidate {
    pub(super) app: OpenApp,
    executable_names: &'static [&'static str],
    install_paths: Vec<PathBuf>,
}

#[derive(Default)]
pub(super) struct AppRoots {
    pub(super) home: Option<PathBuf>,
    pub(super) local_app_data: Option<PathBuf>,
    pub(super) program_files: Option<PathBuf>,
    pub(super) program_files_x86: Option<PathBuf>,
    pub(super) windows_dir: Option<PathBuf>,
}

impl AppRoots {
    #[cfg(any(target_os = "linux", target_os = "windows"))]
    fn from_environment() -> Self {
        Self {
            home: std::env::var_os("HOME").map(PathBuf::from),
            local_app_data: std::env::var_os("LOCALAPPDATA").map(PathBuf::from),
            program_files: std::env::var_os("ProgramFiles").map(PathBuf::from),
            program_files_x86: std::env::var_os("ProgramFiles(x86)").map(PathBuf::from),
            windows_dir: std::env::var_os("WINDIR").map(PathBuf::from),
        }
    }
}

fn app(
    id: &'static str,
    kind: &'static str,
    name: &'static str,
    executable_names: &'static [&'static str],
    install_paths: Vec<PathBuf>,
) -> AppCandidate {
    AppCandidate {
        app: OpenApp { id, kind, name },
        executable_names,
        install_paths,
    }
}

fn rooted_paths(root: Option<&PathBuf>, relatives: &[&str]) -> Vec<PathBuf> {
    root.into_iter()
        .flat_map(|root| relatives.iter().map(|relative| root.join(relative)))
        .collect()
}

fn linux_catalog(roots: &AppRoots) -> Vec<AppCandidate> {
    let home = roots.home.as_ref();
    vec![
        app(
            "system-default",
            "system-default",
            "默认应用",
            &["xdg-open"],
            vec![],
        ),
        app(
            "file-manager",
            "file-manager",
            "文件管理器",
            &["xdg-open"],
            vec![],
        ),
        app(
            "terminal",
            "terminal",
            "Terminal",
            &["x-terminal-emulator"],
            vec![],
        ),
        app(
            "ghostty",
            "terminal",
            "Ghostty",
            &["ghostty"],
            [
                vec![
                    PathBuf::from("/usr/bin/ghostty"),
                    PathBuf::from("/snap/bin/ghostty"),
                ],
                rooted_paths(home, &[".local/bin/ghostty"]),
            ]
            .concat(),
        ),
        app(
            "visual-studio-code",
            "editor",
            "Visual Studio Code",
            &["code"],
            vec![
                PathBuf::from("/usr/bin/code"),
                PathBuf::from("/snap/bin/code"),
                PathBuf::from("/usr/share/code/bin/code"),
            ],
        ),
        app(
            "zed",
            "editor",
            "Zed",
            &["zed", "zed-editor"],
            [
                vec![
                    PathBuf::from("/usr/bin/zed"),
                    PathBuf::from("/usr/bin/zed-editor"),
                ],
                rooted_paths(home, &[".local/bin/zed", ".local/zed.app/bin/zed"]),
            ]
            .concat(),
        ),
        app(
            "windsurf",
            "editor",
            "Windsurf",
            &["windsurf"],
            vec![
                PathBuf::from("/usr/bin/windsurf"),
                PathBuf::from("/snap/bin/windsurf"),
                PathBuf::from("/usr/share/windsurf/windsurf"),
                PathBuf::from("/opt/Windsurf/windsurf"),
            ],
        ),
        app(
            "android-studio",
            "editor",
            "Android Studio",
            &["android-studio", "studio", "studio.sh"],
            [
                vec![
                    PathBuf::from("/opt/android-studio/bin/studio"),
                    PathBuf::from("/opt/android-studio/bin/studio.sh"),
                    PathBuf::from("/usr/local/android-studio/bin/studio.sh"),
                ],
                rooted_paths(home, &["android-studio/bin/studio.sh"]),
            ]
            .concat(),
        ),
        app(
            "gnome-terminal",
            "terminal",
            "GNOME Terminal",
            &["gnome-terminal"],
            vec![],
        ),
        app("konsole", "terminal", "Konsole", &["konsole"], vec![]),
        app(
            "xfce-terminal",
            "terminal",
            "Xfce Terminal",
            &["xfce4-terminal"],
            vec![],
        ),
    ]
}

fn windows_catalog(roots: &AppRoots) -> Vec<AppCandidate> {
    let local = roots.local_app_data.as_ref();
    let program_files = roots.program_files.as_ref();
    let program_files_x86 = roots.program_files_x86.as_ref();
    let windows = roots.windows_dir.as_ref();
    vec![
        app(
            "system-default",
            "system-default",
            "默认应用",
            &["explorer"],
            rooted_paths(windows, &["explorer.exe"]),
        ),
        app(
            "explorer",
            "file-manager",
            "Explorer",
            &["explorer"],
            rooted_paths(windows, &["explorer.exe"]),
        ),
        app(
            "windows-terminal",
            "terminal",
            "Windows Terminal",
            &["wt"],
            rooted_paths(local, &["Microsoft/WindowsApps/wt.exe"]),
        ),
        app(
            "command-prompt",
            "terminal",
            "Command Prompt",
            &["cmd"],
            rooted_paths(windows, &["System32/cmd.exe"]),
        ),
        app(
            "visual-studio-code",
            "editor",
            "Visual Studio Code",
            &["code"],
            [
                rooted_paths(
                    local,
                    &[
                        "Programs/Microsoft VS Code/bin/code.cmd",
                        "Programs/Microsoft VS Code/Code.exe",
                    ],
                ),
                rooted_paths(
                    program_files,
                    &[
                        "Microsoft VS Code/bin/code.cmd",
                        "Microsoft VS Code/Code.exe",
                    ],
                ),
                rooted_paths(
                    program_files_x86,
                    &[
                        "Microsoft VS Code/bin/code.cmd",
                        "Microsoft VS Code/Code.exe",
                    ],
                ),
            ]
            .concat(),
        ),
        app(
            "zed",
            "editor",
            "Zed",
            &["zed"],
            rooted_paths(local, &["Programs/Zed/bin/zed.exe", "Programs/Zed/Zed.exe"]),
        ),
        app(
            "windsurf",
            "editor",
            "Windsurf",
            &["windsurf"],
            [
                rooted_paths(
                    local,
                    &[
                        "Programs/Windsurf/bin/windsurf.cmd",
                        "Programs/Windsurf/Windsurf.exe",
                    ],
                ),
                rooted_paths(
                    program_files,
                    &["Windsurf/bin/windsurf.cmd", "Windsurf/Windsurf.exe"],
                ),
            ]
            .concat(),
        ),
        app(
            "android-studio",
            "editor",
            "Android Studio",
            &["studio64", "studio"],
            [
                rooted_paths(
                    program_files,
                    &[
                        "Android/Android Studio/bin/studio64.exe",
                        "Android/Android Studio/bin/studio.exe",
                    ],
                ),
                rooted_paths(local, &["Programs/Android Studio/bin/studio64.exe"]),
            ]
            .concat(),
        ),
    ]
}

pub(super) fn catalog_for(platform: &str, roots: &AppRoots) -> Vec<AppCandidate> {
    match platform {
        "linux" => linux_catalog(roots),
        "windows" => windows_catalog(roots),
        _ => vec![],
    }
}

pub(super) fn executable_for_app_with(
    catalog: &[AppCandidate],
    app_id: &str,
    mut find_in_path: impl FnMut(&str) -> Option<PathBuf>,
    mut exists: impl FnMut(&Path) -> bool,
) -> Option<PathBuf> {
    let candidate = catalog
        .iter()
        .find(|candidate| candidate.app.id == app_id)?;
    resolve_candidate_with(candidate, &mut find_in_path, &mut exists)
}

fn resolve_candidate_with(
    candidate: &AppCandidate,
    find_in_path: &mut impl FnMut(&str) -> Option<PathBuf>,
    exists: &mut impl FnMut(&Path) -> bool,
) -> Option<PathBuf> {
    candidate
        .executable_names
        .iter()
        .find_map(|name| find_in_path(name))
        .or_else(|| {
            candidate
                .install_paths
                .iter()
                .find(|path| exists(path))
                .cloned()
        })
}

pub(super) fn detect_apps_with(
    catalog: &[AppCandidate],
    mut find_in_path: impl FnMut(&str) -> Option<PathBuf>,
    mut exists: impl FnMut(&Path) -> bool,
) -> Vec<OpenApp> {
    catalog
        .iter()
        .filter_map(|candidate| {
            resolve_candidate_with(candidate, &mut find_in_path, &mut exists).map(|_| candidate.app)
        })
        .collect()
}

#[cfg(any(target_os = "linux", target_os = "windows"))]
pub(super) fn installed_apps(platform: &str) -> Vec<OpenApp> {
    let catalog = catalog_for(platform, &AppRoots::from_environment());
    let path_directories = path_directories();
    detect_apps_with(
        &catalog,
        |name| executable_path_in(&path_directories, name),
        Path::is_file,
    )
}

#[cfg(any(target_os = "linux", target_os = "windows"))]
pub(super) fn launch_program(platform: &str, app_id: &str) -> Option<PathBuf> {
    let catalog = catalog_for(platform, &AppRoots::from_environment());
    executable_for_app_with(&catalog, app_id, executable_path, Path::is_file).or_else(|| {
        catalog
            .iter()
            .find(|candidate| candidate.app.id == app_id)?
            .executable_names
            .first()
            .map(PathBuf::from)
    })
}

#[cfg(any(target_os = "linux", target_os = "windows"))]
fn executable_path(name: &str) -> Option<PathBuf> {
    executable_path_in(&path_directories(), name)
}

#[cfg(any(target_os = "linux", target_os = "windows"))]
fn path_directories() -> Vec<PathBuf> {
    std::env::var_os("PATH")
        .map(|paths| std::env::split_paths(&paths).collect())
        .unwrap_or_default()
}

#[cfg(any(target_os = "linux", target_os = "windows"))]
fn executable_path_in(directories: &[PathBuf], name: &str) -> Option<PathBuf> {
    directories
        .iter()
        .find_map(|directory| executable_in_directory(directory, name))
}

#[cfg(any(target_os = "linux", target_os = "windows"))]
pub(super) fn executable_in_directory(directory: &Path, name: &str) -> Option<PathBuf> {
    let candidate = directory.join(name);
    if candidate.is_file() {
        return Some(candidate);
    }

    #[cfg(target_os = "windows")]
    for extension in ["exe", "cmd"] {
        let candidate = candidate.with_extension(extension);
        if candidate.is_file() {
            return Some(candidate);
        }
    }

    None
}
