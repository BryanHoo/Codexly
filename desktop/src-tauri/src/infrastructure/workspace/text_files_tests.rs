use super::*;
use std::fs;

#[test]
fn text_files_preserve_bom_crlf_and_reject_stale_writes() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("a.md");
    fs::write(&path, "\u{feff}中文\r\n").unwrap();
    let original = read_text_file(root.path(), "a.md").unwrap();
    assert_eq!(original.content, "\u{feff}中文\r\n");
    let input = SaveTextInput {
        path: "a.md".into(),
        content: "\u{feff}修改\r\n".into(),
        expected_version: original.version,
    };
    let saved = save_text_file(root.path(), &input).unwrap();
    assert_ne!(saved.version, input.expected_version);
    assert_eq!(fs::read_to_string(&path).unwrap(), input.content);
    assert!(save_text_file(root.path(), &input).is_err());
    fs::remove_file(&path).unwrap();
    assert!(save_text_file(root.path(), &input).is_err());
    assert!(!path.exists());
}

#[test]
fn text_files_reject_invalid_content_and_paths() {
    let root = tempfile::tempdir().unwrap();
    for content in [
        vec![0, 1],
        vec![255],
        b"a\r\nb\n".to_vec(),
        vec![b'x'; 2 * 1024 * 1024 + 1],
    ] {
        fs::write(root.path().join("a.txt"), content).unwrap();
        assert!(read_text_file(root.path(), "a.txt").is_err());
    }
    fs::write(root.path().join("a.docx"), "fake").unwrap();
    assert!(read_text_file(root.path(), "a.docx").is_err());
    assert!(read_text_file(root.path(), "../a.txt").is_err());
    assert!(read_text_file(root.path(), ".git/config").is_err());
}

#[cfg(unix)]
#[test]
fn text_files_reject_symlinks_and_preserve_permissions() {
    use std::os::unix::fs::{PermissionsExt, symlink};
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("a.txt");
    fs::write(&path, "before").unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o640)).unwrap();
    symlink(&path, root.path().join("link")).unwrap();
    assert!(read_text_file(root.path(), "link").is_err());
    let original = read_text_file(root.path(), "a.txt").unwrap();
    save_text_file(
        root.path(),
        &SaveTextInput {
            path: "a.txt".into(),
            content: "after".into(),
            expected_version: original.version,
        },
    )
    .unwrap();
    assert_eq!(
        fs::metadata(path).unwrap().permissions().mode() & 0o777,
        0o640
    );
}

#[test]
fn text_files_serialize_competing_saves() {
    let root = tempfile::tempdir().unwrap();
    fs::write(root.path().join("a.txt"), "before").unwrap();
    let original = read_text_file(root.path(), "a.txt").unwrap();
    std::thread::scope(|scope| {
        let handles: Vec<_> = ["one", "two"]
            .into_iter()
            .map(|content| {
                let version = &original.version;
                let root = root.path();
                scope.spawn(move || {
                    save_text_file(
                        root,
                        &SaveTextInput {
                            path: "a.txt".into(),
                            content: content.into(),
                            expected_version: version.clone(),
                        },
                    )
                })
            })
            .collect();
        assert_eq!(
            handles
                .into_iter()
                .map(|h| h.join().unwrap())
                .filter(Result::is_ok)
                .count(),
            1
        );
    });
}
