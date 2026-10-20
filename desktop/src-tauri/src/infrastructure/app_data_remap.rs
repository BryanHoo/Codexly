use super::{copy_files, publish, temporary};
use rusqlite::Connection;
use serde_json::Value;
use std::{
    fs,
    io::{self, Write},
    path::Path,
};

fn read(path: &Path) -> io::Result<Option<Value>> {
    match fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(io::Error::other),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error),
    }
}

/// 项目按文件夹去重时同步复制 ID 关联的附件与偏好，源文件继续保留作备份。
pub(super) fn remap(db: &Connection, sql: &str, source: &Path, root: &Path) -> io::Result<()> {
    let mut statement = db.prepare(sql).map_err(io::Error::other)?;
    let rows = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(io::Error::other)?;
    let preferences_path = root.join("agent-settings.json");
    let mut preferences = read(&preferences_path)?;
    let original = read(&source.join("agent-settings.json"))?;
    let mut changed = false;
    for row in rows {
        let (old, new) = row.map_err(io::Error::other)?;
        if [&old, &new].iter().any(|id| {
            id.is_empty()
                || id.len() > 256
                || !id
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        }) {
            return Err(io::Error::other("invalid legacy project identifier"));
        }
        let attachments = source.join("attachments").join(&old);
        if attachments.try_exists()? {
            copy_files(&attachments, &root.join("attachments").join(&new))?;
        }
        let settings = source.join("task-settings").join(&old);
        if settings.try_exists()? {
            let destination = root.join("task-settings").join(&new);
            fs::create_dir_all(&destination)?;
            for entry in fs::read_dir(settings)? {
                let entry = entry?;
                let to = destination.join(entry.file_name());
                if entry.path().extension().is_none_or(|ext| ext != "json")
                    || !entry.file_type()?.is_file()
                    || to.try_exists()?
                {
                    continue;
                }
                let mut value = read(&entry.path())?
                    .ok_or_else(|| io::Error::other("missing legacy task settings"))?;
                if value["projectId"] != old {
                    return Err(io::Error::other("invalid legacy task settings project"));
                }
                value["projectId"] = Value::String(new.clone());
                let temp = temporary(&destination);
                let result =
                    fs::write(&temp, serde_json::to_vec(&value)?).and_then(|_| publish(&temp, &to));
                let _ = fs::remove_file(&temp);
                result?;
            }
        }
        if let (Some(target), Some(original)) = (&mut preferences, &original)
            && let Some(projects) = target["projects"].as_object_mut()
            && let Some(value) = original["projects"].get(&old)
            && !projects.contains_key(&new)
        {
            projects.insert(new, value.clone());
            changed = true;
        }
    }
    if changed {
        crate::infrastructure::atomic_file::write_with(&preferences_path, |file| {
            file.write_all(&serde_json::to_vec(&preferences)?)
        })?;
    }
    Ok(())
}
