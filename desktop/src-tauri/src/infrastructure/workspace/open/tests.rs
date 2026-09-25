use std::{collections::HashSet, path::PathBuf};

use super::catalog::{AppRoots, catalog_for, detect_apps_with, executable_for_app_with};

fn ids_for(platform: &str, roots: &AppRoots) -> HashSet<&'static str> {
    catalog_for(platform, roots)
        .into_iter()
        .map(|candidate| candidate.app.id)
        .collect()
}

#[test]
fn ubuntu_catalog_should_cover_supported_macos_development_apps() {
    let roots = AppRoots::default();
    let ids = ids_for("linux", &roots);

    for app_id in [
        "ghostty",
        "visual-studio-code",
        "zed",
        "windsurf",
        "android-studio",
    ] {
        assert!(ids.contains(app_id), "missing Ubuntu app: {app_id}");
    }
}

#[test]
fn windows_catalog_should_cover_supported_macos_development_apps() {
    let roots = AppRoots {
        local_app_data: Some(PathBuf::from("/local")),
        program_files: Some(PathBuf::from("/program-files")),
        ..AppRoots::default()
    };
    let ids = ids_for("windows", &roots);

    for app_id in ["visual-studio-code", "zed", "windsurf", "android-studio"] {
        assert!(ids.contains(app_id), "missing Windows app: {app_id}");
    }
}

#[test]
fn windows_apps_should_be_detected_from_standard_install_directories() {
    let roots = AppRoots {
        local_app_data: Some(PathBuf::from("/local")),
        program_files: Some(PathBuf::from("/program-files")),
        ..AppRoots::default()
    };
    let catalog = catalog_for("windows", &roots);
    let installed = HashSet::from([
        PathBuf::from("/local/Programs/Zed/Zed.exe"),
        PathBuf::from("/local/Programs/Windsurf/Windsurf.exe"),
        PathBuf::from("/program-files/Android/Android Studio/bin/studio64.exe"),
    ]);
    let apps = detect_apps_with(&catalog, |_| None, |path| installed.contains(path));
    let ids: HashSet<_> = apps.into_iter().map(|app| app.id).collect();

    assert!(ids.contains("zed"));
    assert!(ids.contains("windsurf"));
    assert!(ids.contains("android-studio"));
}

#[test]
fn ubuntu_apps_should_be_detected_from_standard_install_directories() {
    let roots = AppRoots {
        home: Some(PathBuf::from("/home/tester")),
        ..AppRoots::default()
    };
    let catalog = catalog_for("linux", &roots);
    let installed = HashSet::from([
        PathBuf::from("/snap/bin/ghostty"),
        PathBuf::from("/snap/bin/code"),
        PathBuf::from("/home/tester/.local/zed.app/bin/zed"),
        PathBuf::from("/usr/share/windsurf/windsurf"),
        PathBuf::from("/opt/android-studio/bin/studio.sh"),
    ]);
    let apps = detect_apps_with(&catalog, |_| None, |path| installed.contains(path));
    let ids: HashSet<_> = apps.into_iter().map(|app| app.id).collect();

    for app_id in [
        "ghostty",
        "visual-studio-code",
        "zed",
        "windsurf",
        "android-studio",
    ] {
        assert!(
            ids.contains(app_id),
            "missing installed Ubuntu app: {app_id}"
        );
    }
}

#[test]
fn detected_standard_install_path_should_be_reused_for_launching() {
    let roots = AppRoots {
        home: Some(PathBuf::from("/home/tester")),
        ..AppRoots::default()
    };
    let catalog = catalog_for("linux", &roots);
    let installed = PathBuf::from("/home/tester/.local/zed.app/bin/zed");

    let executable = executable_for_app_with(&catalog, "zed", |_| None, |path| path == installed);

    assert_eq!(executable, Some(installed));
}
