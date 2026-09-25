//! 同目录独占临时文件与原子发布；业务锁和容量校验由调用方持有。
use std::{
    fs,
    io::{self, Write},
    path::Path,
};

/// 闭包失败时自动删除临时文件；仅在完整写入成功后替换目标。
pub(crate) fn write_with<T>(
    path: &Path,
    write: impl FnOnce(&mut fs::File) -> io::Result<T>,
) -> io::Result<T> {
    let parent = path
        .parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "missing parent directory"))?;
    let mut temporary = create(parent)?;
    // 更新已有文件时保留权限；新配置采用 tempfile 的私有权限。
    match fs::metadata(path) {
        Ok(metadata) if metadata.is_file() => temporary
            .as_file()
            .set_permissions(metadata.permissions())?,
        Ok(_) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }
    let result = write(temporary.as_file_mut())?;
    // 关闭句柄后再替换，兼顾 Windows；TempPath 在失败和展开时负责清理。
    publish(temporary, path)?;
    Ok(result)
}

/// 流式内容在计算摘要前尚无目标文件名，先创建受 RAII 管理的临时文件。
pub(crate) fn create(directory: &Path) -> io::Result<tempfile::NamedTempFile> {
    fs::create_dir_all(directory)?;
    tempfile::Builder::new()
        .prefix(".codeagent-")
        .suffix(".tmp")
        .tempfile_in(directory)
}

pub(crate) fn publish(temporary: tempfile::NamedTempFile, destination: &Path) -> io::Result<()> {
    let temporary = temporary.into_temp_path();
    #[cfg(not(target_os = "windows"))]
    {
        temporary.persist(destination).map_err(|error| error.error)
    }
    #[cfg(target_os = "windows")]
    {
        let mut temporary = temporary;
        atomicwrites::replace_atomic(&temporary, destination)?;
        // 已成功移走的路径不再清理，避免额外系统调用和误删后续同名文件。
        temporary.disable_cleanup(true);
        Ok(())
    }
}

pub(crate) async fn write_bytes(path: &Path, bytes: Vec<u8>) -> io::Result<()> {
    let path = path.to_owned();
    // 字节所有权移入一次阻塞任务，避免逐步文件操作反复调度线程池。
    tokio::task::spawn_blocking(move || write_with(&path, |file| file.write_all(&bytes)))
        .await
        .map_err(io::Error::other)?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn failed_writer_should_preserve_target_and_remove_partial_file() {
        let root = tempfile::tempdir().unwrap();
        let target = root.path().join("settings.json");
        fs::write(&target, b"original").unwrap();
        let result = write_with(&target, |file| {
            file.write_all(b"partial")?;
            Err::<(), _>(io::Error::other("injected write failure"))
        });
        assert!(result.is_err());
        assert_eq!(fs::read(&target).unwrap(), b"original");
        assert_eq!(fs::read_dir(root.path()).unwrap().count(), 1);
    }

    #[test]
    fn failed_publish_should_remove_temporary_file() {
        let root = tempfile::tempdir().unwrap();
        let target = root.path().join("directory");
        fs::create_dir(&target).unwrap();
        assert!(write_with(&target, |file| file.write_all(b"data")).is_err());
        assert!(target.is_dir());
        assert_eq!(fs::read_dir(root.path()).unwrap().count(), 1);
    }
}
