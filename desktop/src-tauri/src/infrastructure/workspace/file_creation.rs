use super::{
    files::{FileTree, list_project_files},
    path_guard::{WorkspaceError, valid_relative},
};
use serde::Serialize;
use std::path::Path;

#[derive(Debug, Serialize)]
pub struct CreateFileResponse {
    pub path: String,
    pub tree: FileTree,
}

// 新建与重命名共用可移植名称规则，避免部署系统改变校验结果。
pub(super) fn validate_project_file_name(name: &str) -> Result<(), WorkspaceError> {
    let stem = name
        .split('.')
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    let reserved = matches!(stem.as_str(), "con" | "prn" | "aux" | "nul")
        || ["com", "lpt"].iter().any(|prefix| {
            stem.strip_prefix(prefix).is_some_and(|suffix| {
                matches!(
                    suffix,
                    "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"
                )
            })
        });
    if name.is_empty()
        || name.chars().count() > 255
        || name.ends_with(['.', ' '])
        || reserved
        || name.chars().any(|c| {
            c.is_control() || matches!(c, '/' | '\\' | '<' | '>' | ':' | '"' | '|' | '?' | '*')
        })
    {
        return Err(WorkspaceError::InvalidPath);
    }
    Ok(())
}

pub async fn create_project_file(
    root: &Path,
    parent: Option<&str>,
    name: &str,
    kind: &str,
) -> Result<CreateFileResponse, WorkspaceError> {
    validate_project_file_name(name)?;
    if !matches!(kind, "file" | "directory") {
        return Err(WorkspaceError::InvalidPath);
    }
    let root = tokio::fs::canonicalize(root).await?;
    let directory = match parent {
        Some(parent) => {
            // 新建限定项目内部；拒绝跨平台分隔符和超深路径，再核对真实父目录边界。
            if parent.contains(['\\', ':'])
                || parent.split('/').count() >= 20
                || parent
                    .split('/')
                    .any(|part| part.is_empty() || part == "." || part == "..")
            {
                return Err(WorkspaceError::InvalidPath);
            }
            tokio::fs::canonicalize(root.join(valid_relative(parent)?)).await?
        }
        None => root.clone(),
    };
    if !directory.starts_with(&root) || !tokio::fs::metadata(&directory).await?.is_dir() {
        return Err(WorkspaceError::InvalidPath);
    }
    let destination = directory.join(name);
    // create_new/create_dir 自身保证独占创建，不能用存在性预检查代替原子语义。
    if kind == "directory" {
        tokio::fs::create_dir(destination).await?;
    } else {
        tokio::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(destination)
            .await?;
    }
    let path = parent.map_or_else(|| name.to_owned(), |parent| format!("{parent}/{name}"));
    let tree = list_project_files(&root, parent).await?;
    Ok(CreateFileResponse { path, tree })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[tokio::test]
    async fn creation_should_preserve_existing_content_and_reject_unsafe_paths() {
        let root = std::env::temp_dir().join(format!("codexly-create-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let root = fs::canonicalize(root).unwrap();
        let folder = create_project_file(&root, None, "中文目录", "directory")
            .await
            .unwrap();
        assert_eq!(folder.path, "中文目录");
        let file = create_project_file(&root, Some("中文目录"), "新文件.txt", "file")
            .await
            .unwrap();
        assert_eq!(file.path, "中文目录/新文件.txt");
        fs::write(root.join(&file.path), "preserved").unwrap();
        assert!(
            create_project_file(&root, Some("中文目录"), "新文件.txt", "file")
                .await
                .is_err()
        );
        assert_eq!(
            fs::read_to_string(root.join(&file.path)).unwrap(),
            "preserved"
        );
        for name in [
            "",
            ".",
            "..",
            "a/b",
            "a\\b",
            "CON",
            "nul.txt",
            "bad.",
            "bad:",
            "bad\0name",
        ] {
            assert!(
                create_project_file(&root, None, name, "file")
                    .await
                    .is_err(),
                "{name:?}"
            );
        }
        for parent in ["..", "a/../b", "/tmp", "C:/Windows", "a\\b", "missing"] {
            assert!(
                create_project_file(&root, Some(parent), "escape", "file")
                    .await
                    .is_err(),
                "{parent}"
            );
        }
        let results = tokio::join!(
            create_project_file(&root, None, "race", "file"),
            create_project_file(&root, None, "race", "file")
        );
        assert_ne!(results.0.is_ok(), results.1.is_ok());
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn creation_should_reject_parent_symlinks_outside_the_project() {
        let base =
            std::env::temp_dir().join(format!("codexly-create-link-{}", uuid::Uuid::new_v4()));
        let root = base.join("root");
        let outside = base.join("outside");
        fs::create_dir_all(&root).unwrap();
        fs::create_dir(&outside).unwrap();
        std::os::unix::fs::symlink(&outside, root.join("linked")).unwrap();
        assert!(
            create_project_file(&root, Some("linked"), "escape", "file")
                .await
                .is_err()
        );
        assert_eq!(fs::read_dir(outside).unwrap().count(), 0);
        fs::remove_dir_all(base).unwrap();
    }
}
