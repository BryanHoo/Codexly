use std::path::{Path, PathBuf};

use serde::Serialize;
use tokio::io::{AsyncReadExt, AsyncSeekExt};

use super::path_guard::{WorkspaceError, relative_string, resolve_destination, resolve_existing};

const SOURCE_CHUNK_BYTES: usize = 256 * 1024;

#[derive(Debug, Serialize)]
pub struct FileTree {
    pub entries: Vec<FileTreeEntry>,
    pub path: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct FileTreeEntry {
    pub path: String,
    #[serde(rename = "type")]
    pub kind: &'static str,
}

#[derive(Debug, Serialize)]
pub struct RenameFileResponse {
    pub path: String,
}

#[derive(Debug, Serialize)]
pub struct DeleteFileResponse {
    pub path: String,
    pub status: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceFile {
    pub content: String,
    pub next_cursor: Option<usize>,
    pub path: String,
}

pub async fn list_project_files(
    root: &Path,
    relative: Option<&str>,
) -> Result<FileTree, WorkspaceError> {
    let directory = resolve_existing(root, relative).await?;
    if !tokio::fs::metadata(&directory).await?.is_dir() {
        return Err(WorkspaceError::InvalidPath);
    }
    let mut reader = tokio::fs::read_dir(&directory).await?;
    let mut entries = Vec::new();
    while let Some(entry) = reader.next_entry().await? {
        let file_type = entry.file_type().await?;
        let file_name = entry.file_name();
        if file_type.is_symlink() || matches!(file_name.to_str(), Some(".git" | ".DS_Store")) {
            continue;
        }
        entries.push(FileTreeEntry {
            path: relative_string(root, &entry.path())?,
            kind: if file_type.is_dir() {
                "directory"
            } else {
                "file"
            },
        });
    }
    entries.sort_unstable_by(|left, right| {
        left.kind
            .cmp(right.kind)
            .then_with(|| left.path.to_lowercase().cmp(&right.path.to_lowercase()))
            .then_with(|| left.path.cmp(&right.path))
    });
    Ok(FileTree {
        entries,
        path: relative.map(str::to_owned),
    })
}

pub async fn rename_project_file(
    root: &Path,
    relative: &str,
    name: &str,
) -> Result<RenameFileResponse, WorkspaceError> {
    if name.is_empty()
        || name == "."
        || name == ".."
        || name.contains(['/', '\\', '\0', '\r', '\n'])
    {
        return Err(WorkspaceError::InvalidPath);
    }
    let (source, _) = resolve_mutation_target(root, relative).await?;
    // 使用已解析的同一个父目录，避免再次解析用户路径时重定向到其他位置。
    let destination = source.with_file_name(name);
    match tokio::fs::symlink_metadata(&destination).await {
        Ok(_) => return Err(WorkspaceError::InvalidPath),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.into()),
    }
    tokio::fs::rename(source, &destination).await?;
    Ok(RenameFileResponse {
        path: relative_string(root, &destination)?,
    })
}

pub async fn delete_project_file(
    root: &Path,
    relative: &str,
) -> Result<DeleteFileResponse, WorkspaceError> {
    let (target, file_type) = resolve_mutation_target(root, relative).await?;
    if file_type.is_dir() {
        // 保留末级目录项；检查后即使被替换为链接，remove_dir_all 也不会递归其目标。
        tokio::fs::remove_dir_all(&target).await?;
    } else {
        tokio::fs::remove_file(&target).await?;
    }
    Ok(DeleteFileResponse {
        path: relative.to_owned(),
        status: "deleted",
    })
}

async fn resolve_mutation_target(
    root: &Path,
    relative: &str,
) -> Result<(PathBuf, std::fs::FileType), WorkspaceError> {
    // 拒绝末尾分隔符和点目录，防止路径语义强制解析末级符号链接。
    if matches!(
        relative.rsplit(std::path::is_separator).next(),
        Some("" | "." | "..")
    ) {
        return Err(WorkspaceError::InvalidPath);
    }
    // 只 canonicalize 父目录，绝不把待删除或重命名的末级目录项替换为链接目标。
    let target = resolve_destination(root, Path::new(relative)).await?;
    if target == tokio::fs::canonicalize(root).await? {
        return Err(WorkspaceError::InvalidPath);
    }
    let metadata = tokio::fs::symlink_metadata(&target).await?;
    if metadata.is_symlink() {
        return Err(WorkspaceError::InvalidPath);
    }
    Ok((target, metadata.file_type()))
}

pub async fn read_source_file(
    root: &Path,
    relative: &str,
    cursor: Option<usize>,
) -> Result<SourceFile, WorkspaceError> {
    let path = resolve_existing(root, Some(relative)).await?;
    if !tokio::fs::metadata(&path).await?.is_file() {
        return Err(WorkspaceError::InvalidPath);
    }
    let offset = cursor.unwrap_or(0);
    let mut file = tokio::fs::File::open(path).await?;
    let length =
        usize::try_from(file.metadata().await?.len()).map_err(|_| WorkspaceError::InvalidPath)?;
    if offset > length {
        return Err(WorkspaceError::InvalidPath);
    }
    file.seek(std::io::SeekFrom::Start(offset as u64)).await?;
    let mut bytes = vec![0; SOURCE_CHUNK_BYTES.min(length.saturating_sub(offset))];
    file.read_exact(&mut bytes).await?;
    let content = String::from_utf8(bytes).map_err(|_| WorkspaceError::InvalidPath)?;
    let next = offset + content.len();
    Ok(SourceFile {
        content,
        next_cursor: (next < length).then_some(next),
        path: relative.to_owned(),
    })
}

#[cfg(test)]
#[path = "files_symlink_tests.rs"]
mod symlink_tests;

#[cfg(test)]
mod tests {
    use std::{fs, time::SystemTime};

    use super::*;

    #[tokio::test]
    async fn file_operations_should_support_project_relative_paths() {
        let unique = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("codeagent-workspace-{unique}"));
        fs::create_dir_all(root.join("src")).unwrap();
        fs::write(root.join("src/main.rs"), "fn main() {}\n").unwrap();
        fs::write(root.join("src/.DS_Store"), b"finder metadata").unwrap();
        let root = fs::canonicalize(root).unwrap();

        let tree = list_project_files(&root, Some("src")).await.unwrap();
        assert_eq!(
            tree.entries
                .iter()
                .map(|entry| entry.path.as_str())
                .collect::<Vec<_>>(),
            ["src/main.rs"]
        );
        assert!(read_source_file(&root, "../outside", None).await.is_err());
        let renamed = rename_project_file(&root, "src/main.rs", "lib.rs")
            .await
            .unwrap();
        assert_eq!(renamed.path, "src/lib.rs");
        delete_project_file(&root, "src/lib.rs").await.unwrap();
        assert!(!root.join("src/lib.rs").exists());

        fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn file_operations_should_read_and_rename_outside_project_root() {
        let unique = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let directory = std::env::temp_dir().join(format!("codeagent-external-files-{unique}"));
        let root = directory.join("project");
        fs::create_dir_all(&root).unwrap();
        let file = directory.join("中文 文档.txt");
        fs::write(&file, "external document").unwrap();
        let result = async {
            let source = read_source_file(&root, file.to_str().unwrap(), None).await?;
            assert_eq!(source.content, "external document");
            let renamed = rename_project_file(&root, "../中文 文档.txt", "新文档.txt").await?;
            delete_project_file(&root, &renamed.path).await
        }
        .await;
        fs::remove_dir_all(directory).unwrap();
        assert!(result.is_ok(), "{result:?}");
    }
}
