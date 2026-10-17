use super::*;
use sha2::{Digest, Sha256};
use std::io::Write;

#[test]
fn install_verifies_before_publish_and_preserves_previous_runtime_on_failure() {
    let dir = tempfile::tempdir().unwrap();
    let archive = dir.path().join("host.gz");
    let target = dir.path().join("claude-host");
    let bytes = b"runtime-contract";
    let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
    encoder.write_all(bytes).unwrap();
    std::fs::write(&archive, encoder.finish().unwrap()).unwrap();
    let digest = digest(bytes);
    files::extract(&archive, &target, &digest, true).unwrap();
    assert!(files::verified(&target, &digest));
    assert!(files::extract(&archive, &target, &"0".repeat(64), true).is_err());
    assert_eq!(std::fs::read(&target).unwrap(), bytes);
}
#[test]
fn native_archive_extracts_only_expected_regular_executable() {
    let dir = tempfile::tempdir().unwrap();
    let archive = dir.path().join("native.tgz");
    let name = format!("claude{}", std::env::consts::EXE_SUFFIX);
    let mut tar = tar::Builder::new(flate2::write::GzEncoder::new(
        Vec::new(),
        flate2::Compression::fast(),
    ));
    for (path, bytes) in [
        ("package/README.md".to_owned(), b"license".as_slice()),
        (format!("package/{name}"), b"native".as_slice()),
    ] {
        let mut header = tar::Header::new_gnu();
        header.set_size(bytes.len() as u64);
        header.set_mode(0o755);
        header.set_cksum();
        tar.append_data(&mut header, path, bytes).unwrap();
    }
    std::fs::write(&archive, tar.into_inner().unwrap().finish().unwrap()).unwrap();
    let target = dir.path().join(&name);
    files::extract(&archive, &target, &digest(b"native"), false).unwrap();
    assert_eq!(std::fs::read(target).unwrap(), b"native");
    assert!(!dir.path().join("README.md").exists());
}
#[tokio::test]
async fn compatible_cached_dependencies_never_access_network_and_only_changed_host_is_missing() {
    let dir = tempfile::tempdir().unwrap();
    let digest = digest(b"cached");
    let dependency = Dependency {
        version: "1".into(),
        url: "https://invalid.invalid/runtime".into(),
        fallback_url: None,
        integrity: "invalid".into(),
        sha256: digest.clone(),
    };
    let directory = dir.path().join("native").join(&digest);
    std::fs::create_dir_all(&directory).unwrap();
    let binary = directory.join(format!("claude{}", std::env::consts::EXE_SUFFIX));
    std::fs::write(&binary, b"cached").unwrap();
    let on_progress = |_| panic!("cached binary must not download");
    let mut progress = DownloadProgressReporter::for_version(&on_progress, None, "1");
    assert_eq!(
        install(dir.path(), &dependency, false, &mut progress)
            .await
            .unwrap(),
        binary
    );
    assert!(
        install(dir.path(), &dependency, true, &mut progress)
            .await
            .is_err()
    );
    assert_eq!(std::fs::read(binary).unwrap(), b"cached");
}

fn digest(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

#[tokio::test]
async fn application_upgrade_reuses_verified_legacy_native_binary() {
    let dir = tempfile::tempdir().unwrap();
    let directory = dir.path().join("0.3.300");
    std::fs::create_dir_all(&directory).unwrap();
    let binary = directory.join(format!("claude{}", std::env::consts::EXE_SUFFIX));
    std::fs::write(&binary, b"legacy").unwrap();
    let dependency = Dependency {
        version: "0.3.300".into(),
        url: "https://invalid.invalid/runtime".into(),
        fallback_url: None,
        integrity: "invalid".into(),
        sha256: digest(b"legacy"),
    };
    let on_progress = |_| panic!("compatible legacy runtime must not download");
    let mut progress = DownloadProgressReporter::for_version(&on_progress, None, "0.3.300");
    assert_eq!(
        install(dir.path(), &dependency, false, &mut progress)
            .await
            .unwrap(),
        binary
    );
}

#[test]
fn dependency_contract_rejects_wrong_sdk_version_or_platform() {
    let native = Dependency {
        version: "1".into(),
        url: String::new(),
        fallback_url: None,
        integrity: String::new(),
        sha256: "a".repeat(64),
    };
    let mut manifest = Manifest {
        schema_version: 1,
        sdk_version: "1",
        platform: match std::env::consts::OS {
            "macos" => "darwin",
            "windows" => "win32",
            other => other,
        }
        .into(),
        arch: match std::env::consts::ARCH {
            "aarch64" => "arm64",
            "x86_64" => "x64",
            other => other,
        }
        .into(),
        native: native.clone(),
        host: native,
    };
    assert!(manifest.validate().is_ok());
    manifest.native.version = "2".into();
    assert!(manifest.validate().is_err());
    manifest.native.version = "1".into();
    manifest.platform = "wrong".into();
    assert!(manifest.validate().is_err());
}
#[test]
fn windows_legacy_layout_reuses_matching_native_binary_and_ignores_stale_bytes() {
    let dir = tempfile::tempdir().unwrap();
    let old_host = dir.path().join("a".repeat(64));
    std::fs::create_dir_all(&old_host).unwrap();
    let binary = old_host.join("claude.exe");
    std::fs::write(&binary, b"native").unwrap();
    assert_eq!(
        files::legacy_binary(dir.path(), "claude.exe", &digest(b"native")),
        Some(binary)
    );
    assert!(files::legacy_binary(dir.path(), "claude.exe", &digest(b"changed")).is_none());
}
