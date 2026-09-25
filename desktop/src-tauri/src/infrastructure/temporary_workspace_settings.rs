use std::{
    io,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

use serde::{Deserialize, Serialize};
use tokio::{fs, sync::Mutex};

static SETTINGS_LOCK: Mutex<()> = Mutex::const_new(());
static WRITE_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TemporaryWorkspaceSettings {
    pub root_path: PathBuf,
}

pub async fn read_root(app_data: &Path) -> io::Result<PathBuf> {
    let bytes = match fs::read(app_data.join("temporary-workspace-settings.json")).await {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return Ok(app_data.join("temporary-workspaces"));
        }
        Err(error) => return Err(error),
    };
    let settings: TemporaryWorkspaceSettings = serde_json::from_slice(&bytes)?;
    if !settings.root_path.is_absolute() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "workspace root must be absolute",
        ));
    }
    Ok(settings.root_path)
}

pub async fn save_root(app_data: &Path, root: &Path) -> io::Result<Option<PathBuf>> {
    let _guard = SETTINGS_LOCK.lock().await;
    if !root.is_absolute() || !fs::metadata(root).await?.is_dir() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "workspace root must be a directory",
        ));
    }
    let root = fs::canonicalize(root).await?;
    let current = read_root(app_data).await?;
    let current = match fs::canonicalize(&current).await {
        Ok(path) => path,
        Err(error) if error.kind() == io::ErrorKind::NotFound => current,
        Err(error) => return Err(error),
    };
    // 比较规范路径，原目录及其符号链接别名都不触发写权限探测或配置写入。
    if root == current {
        return Ok(None);
    }
    // 保存前实际验证写权限；探测文件独占创建，不覆盖用户文件。
    let probe = root.join(format!(
        ".codeagent-write-{}-{}",
        std::process::id(),
        WRITE_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ));
    let file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&probe)
        .await?;
    drop(file);
    fs::remove_file(probe).await?;
    write_json(
        app_data,
        "temporary-workspace-settings.json",
        &TemporaryWorkspaceSettings {
            root_path: root.clone(),
        },
    )
    .await?;
    Ok(Some(root))
}

pub(super) async fn write_json(
    directory: &Path,
    name: &str,
    value: &impl Serialize,
) -> io::Result<()> {
    super::atomic_file::write_bytes(&directory.join(name), serde_json::to_vec(value)?).await
}

pub(super) fn index_path(app_data: &Path, task_id: &str) -> io::Result<PathBuf> {
    if task_id.is_empty()
        || task_id.len() > 128
        || !task_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "invalid workspace task id",
        ));
    }
    Ok(app_data
        .join("temporary-workspace-index")
        .join(format!("{task_id}.json")))
}

pub async fn task_workspace(app_data: &Path, task_id: &str) -> io::Result<Option<PathBuf>> {
    match fs::read(index_path(app_data, task_id)?).await {
        Ok(bytes) => Ok(Some(serde_json::from_slice(&bytes)?)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn unchanged_root_should_skip_persistence() {
        let app_data = std::env::temp_dir().join(format!(
            "codeagent-unchanged-root-{}-{}",
            std::process::id(),
            WRITE_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        let root = read_root(&app_data).await.unwrap();
        fs::create_dir_all(&root).await.unwrap();
        assert!(
            save_root(&app_data, &root.join("."))
                .await
                .unwrap()
                .is_none()
        );
        assert!(!app_data.join("temporary-workspace-settings.json").exists());
        let selected = app_data.join("selected");
        fs::create_dir_all(&selected).await.unwrap();
        assert_eq!(
            save_root(&app_data, &selected).await.unwrap(),
            Some(fs::canonicalize(&selected).await.unwrap())
        );
        let settings_path = app_data.join("temporary-workspace-settings.json");
        let original = fs::read(&settings_path).await.unwrap();
        let mut preserved = original.clone();
        preserved.push(b'\n');
        fs::write(&settings_path, &preserved).await.unwrap();
        assert!(save_root(&app_data, &selected).await.unwrap().is_none());
        assert_eq!(fs::read(&settings_path).await.unwrap(), preserved);
        fs::remove_dir_all(app_data).await.unwrap();
    }
}
