use std::{io, path::Path};

#[derive(serde::Serialize)]
pub struct CreateProjectDirectoryResponse {
    path: String,
    status: &'static str,
}

fn valid_name(name: &str) -> bool {
    let base = name
        .split('.')
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    let reserved = matches!(base.as_str(), "con" | "prn" | "aux" | "nul")
        || ["com", "lpt"].iter().any(|prefix| {
            base.strip_prefix(prefix).is_some_and(|suffix| {
                matches!(
                    suffix,
                    "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"
                )
            })
        });
    !name.is_empty()
        && name.encode_utf16().count() <= 255
        && name == name.trim()
        && !name.ends_with(['.', ' '])
        && !reserved
        && !name
            .chars()
            .any(|c| c <= '\u{001f}' || "<>:\"/\\|?*".contains(c))
}

pub async fn create_project_directory(
    parent_path: &str,
    name: &str,
) -> io::Result<CreateProjectDirectoryResponse> {
    if !Path::new(parent_path).is_absolute() || !valid_name(name) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "invalid folder name or parent path",
        ));
    }
    let parent = tokio::fs::canonicalize(parent_path).await?;
    let path = parent.join(name);
    // 仅创建一层；同名目录需要用户明确选择复用，符号链接不视为可复用目录。
    let status = match tokio::fs::create_dir(&path).await {
        Ok(()) => "created",
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
            if tokio::fs::symlink_metadata(&path).await?.is_dir() {
                "exists-directory"
            } else {
                "exists-file"
            }
        }
        Err(error) => return Err(error),
    };
    Ok(CreateProjectDirectoryResponse {
        path: path.to_string_lossy().into_owned(),
        status,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn creates_child_and_preserves_existing_entries() {
        let parent = tempfile::tempdir().unwrap();
        let parent_path = parent.path().to_str().unwrap();
        assert_eq!(
            create_project_directory(parent_path, "demo")
                .await
                .unwrap()
                .status,
            "created"
        );
        assert_eq!(
            create_project_directory(parent_path, "demo")
                .await
                .unwrap()
                .status,
            "exists-directory"
        );
        tokio::fs::write(parent.path().join("file"), "keep")
            .await
            .unwrap();
        assert_eq!(
            create_project_directory(parent_path, "file")
                .await
                .unwrap()
                .status,
            "exists-file"
        );
        for name in [
            "",
            " ",
            "..",
            "../escape",
            "a/b",
            "a\\b",
            "CON",
            "LPT1.txt",
            "trailing.",
        ] {
            assert_eq!(
                create_project_directory(parent_path, name)
                    .await
                    .err()
                    .unwrap()
                    .kind(),
                io::ErrorKind::InvalidInput
            );
        }
    }
}
