#![cfg(any(unix, windows))]

use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use super::*;

struct Fixture(PathBuf);

impl Fixture {
    fn new() -> Self {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path =
            std::env::temp_dir().join(format!("workspace-symlink-{}-{unique}", std::process::id()));
        fs::create_dir_all(&path).unwrap();
        Self(fs::canonicalize(path).unwrap())
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}

fn link_directory(target: &Path, link: &Path) {
    #[cfg(unix)]
    std::os::unix::fs::symlink(target, link).unwrap();
    #[cfg(windows)]
    std::os::windows::fs::symlink_dir(target, link).unwrap();
}

#[tokio::test]
async fn delete_should_reject_directory_replaced_by_symlink_after_listing() {
    let fixture = Fixture::new();
    let root = &fixture.0;
    fs::create_dir(root.join("visible")).unwrap();
    fs::create_dir(root.join("real")).unwrap();
    fs::write(root.join("real/keep.txt"), "keep").unwrap();
    let tree = list_project_files(root, None).await.unwrap();
    let listed = tree
        .entries
        .iter()
        .find(|entry| entry.path == "visible")
        .unwrap();
    // 固定并发交错顺序：列表返回后，其他工具将目录项替换为链接。
    fs::remove_dir(root.join("visible")).unwrap();
    link_directory(&root.join("real"), &root.join("visible"));

    let result = delete_project_file(root, &listed.path).await;
    assert!(
        root.join("real/keep.txt").exists(),
        "must preserve link target"
    );
    assert!(matches!(result, Err(WorkspaceError::InvalidPath)));
    assert!(
        fs::symlink_metadata(root.join("visible"))
            .unwrap()
            .is_symlink()
    );
}

#[tokio::test]
async fn rename_should_reject_directory_replaced_by_symlink_after_listing() {
    let fixture = Fixture::new();
    let root = &fixture.0;
    fs::create_dir(root.join("visible")).unwrap();
    fs::create_dir(root.join("real")).unwrap();
    fs::write(root.join("real/keep.txt"), "keep").unwrap();
    let tree = list_project_files(root, None).await.unwrap();
    let listed = tree
        .entries
        .iter()
        .find(|entry| entry.path == "visible")
        .unwrap();
    fs::remove_dir(root.join("visible")).unwrap();
    link_directory(&root.join("real"), &root.join("visible"));

    let result = rename_project_file(root, &listed.path, "renamed").await;
    assert!(
        root.join("real/keep.txt").exists(),
        "must preserve link target"
    );
    assert!(matches!(result, Err(WorkspaceError::InvalidPath)));
    assert!(!root.join("renamed").exists());
}

#[tokio::test]
async fn rename_should_reject_dangling_destination_symlink() {
    let fixture = Fixture::new();
    let root = &fixture.0;
    fs::create_dir(root.join("source")).unwrap();
    link_directory(&root.join("missing"), &root.join("destination"));
    let result = rename_project_file(root, "source", "destination").await;
    assert!(matches!(result, Err(WorkspaceError::InvalidPath)));
    assert!(root.join("source").is_dir());
    assert!(
        fs::symlink_metadata(root.join("destination"))
            .unwrap()
            .is_symlink()
    );
}

#[tokio::test]
async fn mutations_should_reject_directory_suffixes_and_project_root() {
    let fixture = Fixture::new();
    let root = &fixture.0;
    fs::create_dir(root.join("real")).unwrap();
    fs::write(root.join("real/keep.txt"), "keep").unwrap();
    link_directory(&root.join("real"), &root.join("link"));
    for path in [
        "link/",
        "link/.",
        "link/..",
        "",
        ".",
        "..",
        root.to_str().unwrap(),
    ] {
        assert!(
            matches!(
                delete_project_file(root, path).await,
                Err(WorkspaceError::InvalidPath)
            ),
            "{path}"
        );
        assert!(
            matches!(
                rename_project_file(root, path, "renamed").await,
                Err(WorkspaceError::InvalidPath)
            ),
            "{path}"
        );
    }
    assert_eq!(
        fs::read_to_string(root.join("real/keep.txt")).unwrap(),
        "keep"
    );
}

#[tokio::test]
async fn deletion_should_preserve_targets_of_links_inside_directory() {
    let fixture = Fixture::new();
    let root = &fixture.0;
    fs::create_dir(root.join("real")).unwrap();
    fs::write(root.join("real/keep.txt"), "keep").unwrap();
    fs::create_dir(root.join("source")).unwrap();
    link_directory(&root.join("real"), &root.join("source/link"));
    delete_project_file(root, "source").await.unwrap();
    assert!(!root.join("source").exists());
    assert_eq!(
        fs::read_to_string(root.join("real/keep.txt")).unwrap(),
        "keep"
    );
}

#[tokio::test]
async fn resolved_mutation_path_should_not_follow_late_symlink_replacement() {
    let fixture = Fixture::new();
    let root = &fixture.0;
    fs::create_dir(root.join("source")).unwrap();
    fs::create_dir(root.join("real")).unwrap();
    fs::write(root.join("real/keep.txt"), "keep").unwrap();
    let (source, _) = resolve_mutation_target(root, "source").await.unwrap();
    // 固定更晚的交错：元数据检查通过后再替换，系统调用仍只能操作链接目录项。
    fs::remove_dir(&source).unwrap();
    link_directory(&root.join("real"), &source);
    let renamed = source.with_file_name("renamed");
    tokio::fs::rename(&source, &renamed).await.unwrap();
    assert!(fs::symlink_metadata(&renamed).unwrap().is_symlink());
    tokio::fs::remove_dir_all(&renamed).await.unwrap();
    assert_eq!(
        fs::read_to_string(root.join("real/keep.txt")).unwrap(),
        "keep"
    );
}
