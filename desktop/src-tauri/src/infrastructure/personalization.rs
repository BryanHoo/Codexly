use crate::domain::personalization::GlobalInstructions;
use std::{io, path::Path};
use tokio::{fs, sync::Mutex};

static INSTRUCTIONS_LOCK: Mutex<()> = Mutex::const_new(());

async fn read_optional(path: &Path) -> io::Result<String> {
    match fs::read_to_string(path).await {
        Ok(content) => Ok(content),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(String::new()),
        Err(error) => Err(error),
    }
}

pub async fn read_instructions(home: &Path) -> io::Result<GlobalInstructions> {
    let path = home.join("AGENTS.md");
    Ok(GlobalInstructions {
        content: read_optional(&path).await?,
        path: path.to_string_lossy().into_owned(),
        override_active: !read_optional(&home.join("AGENTS.override.md"))
            .await?
            .trim()
            .is_empty(),
    })
}

pub async fn save_instructions(
    home: &Path,
    content: &str,
    expected_content: &str,
) -> io::Result<GlobalInstructions> {
    let _guard = INSTRUCTIONS_LOCK.lock().await;
    let path = home.join("AGENTS.md");
    // 保存前比较原文，避免覆盖用户在其他编辑器中已经修改的说明。
    if read_optional(&path).await? != expected_content {
        return Err(io::Error::new(
            io::ErrorKind::AlreadyExists,
            "global instructions changed; reload before saving",
        ));
    }
    fs::create_dir_all(home).await?;
    // 跟随符号链接写入真实文件，避免原子替换破坏用户的配置链接。
    let target = match fs::canonicalize(&path).await {
        Ok(target) => target,
        Err(error) if error.kind() == io::ErrorKind::NotFound => path,
        Err(error) => return Err(error),
    };
    let bytes = content.as_bytes().to_vec();
    tokio::task::spawn_blocking(move || {
        super::atomic_file::write_with(&target, |file| {
            use std::io::Write;
            file.write_all(&bytes)?;
            file.sync_all()
        })
    })
    .await
    .map_err(io::Error::other)??;
    read_instructions(home).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn instructions_should_round_trip_and_reject_stale_edits() {
        let home = std::env::temp_dir().join(format!(
            "personalization-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        tokio::fs::create_dir_all(&home).await.unwrap();
        let initial = read_instructions(&home).await.unwrap();
        assert_eq!(initial.content, "");
        let content = "# 全局说明\r\n  保留空格\n";
        save_instructions(&home, content, "").await.unwrap();
        assert_eq!(read_instructions(&home).await.unwrap().content, content);
        assert!(save_instructions(&home, "stale", "").await.is_err());
        assert_eq!(
            tokio::fs::read_to_string(home.join("AGENTS.md"))
                .await
                .unwrap(),
            content
        );
        save_instructions(&home, "", content).await.unwrap();
        assert_eq!(read_instructions(&home).await.unwrap().content, "");
        tokio::fs::remove_dir_all(home).await.unwrap();
    }
}
