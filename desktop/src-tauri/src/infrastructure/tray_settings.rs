use std::{io, path::Path};

use serde::{Deserialize, Serialize};

#[derive(Deserialize, Serialize)]
struct TraySettings {
    visible: bool,
}

pub async fn read_visible(app_data: &Path) -> io::Result<bool> {
    match tokio::fs::read(app_data.join("tray-settings.json")).await {
        Ok(bytes) => Ok(serde_json::from_slice::<TraySettings>(&bytes)?.visible),
        // 旧安装和首次启动没有此文件，默认保持图标显示。
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(true),
        Err(error) => Err(error),
    }
}

pub async fn write_visible(app_data: &Path, visible: bool) -> io::Result<()> {
    // 复用原子替换，保存失败时保留原配置，避免重启后读取半写入内容。
    super::atomic_file::write_bytes(
        &app_data.join("tray-settings.json"),
        serde_json::to_vec(&TraySettings { visible })?,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn missing_tray_settings_should_default_to_visible() {
        let root = tempfile::tempdir().unwrap();
        assert!(read_visible(root.path()).await.unwrap());
    }

    #[tokio::test]
    async fn tray_settings_should_preserve_visibility_after_reload() {
        let root = tempfile::tempdir().unwrap();
        for visible in [false, true] {
            write_visible(root.path(), visible).await.unwrap();
            assert_eq!(read_visible(root.path()).await.unwrap(), visible);
        }
    }

    #[tokio::test]
    async fn invalid_tray_settings_should_not_silently_override_preference() {
        let root = tempfile::tempdir().unwrap();
        tokio::fs::write(
            root.path().join("tray-settings.json"),
            br#"{"visible":"false"}"#,
        )
        .await
        .unwrap();
        assert!(read_visible(root.path()).await.is_err());
    }

    #[tokio::test]
    async fn failed_tray_settings_write_should_preserve_existing_target() {
        let root = tempfile::tempdir().unwrap();
        let target = root.path().join("tray-settings.json");
        tokio::fs::create_dir(&target).await.unwrap();
        assert!(write_visible(root.path(), false).await.is_err());
        assert!(target.is_dir());
    }
}
