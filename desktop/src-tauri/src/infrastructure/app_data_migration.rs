#[path = "app_data_remap.rs"]
mod remap;
use rusqlite::{Connection, OpenFlags, OptionalExtension, TransactionBehavior};
use serde_json::Value;
use std::{
    fs, io,
    path::{Path, PathBuf},
    time::Duration,
};

fn sql_error(error: rusqlite::Error) -> io::Error {
    io::Error::other(error)
}

fn publish(temporary: &Path, target: &Path) -> io::Result<()> {
    // 原子且禁止覆盖，两个端同时首次启动也不会替换对方已经打开的数据库。
    let result = match fs::hard_link(temporary, target) {
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => Ok(()),
        result => result,
    };
    fs::remove_file(temporary)?;
    result
}

fn temporary(root: &Path) -> PathBuf {
    root.join(format!(".migration-{}.tmp", uuid::Uuid::new_v4()))
}

fn copy_files(source: &Path, target: &Path) -> io::Result<()> {
    fs::create_dir_all(target)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let name = entry.file_name();
        let text = name.to_string_lossy();
        // SQLite 必须通过连接读取其 WAL；旧锁、临时文件和符号链接不进入新业务目录。
        if text.contains(".sqlite3")
            || [
                ".sqlite3",
                ".sqlite3-wal",
                ".sqlite3-shm",
                ".sqlite3-journal",
                ".lock",
                ".tmp",
            ]
            .iter()
            .any(|suffix| text.ends_with(suffix))
        {
            continue;
        }
        let kind = entry.file_type()?;
        let to = target.join(name);
        if kind.is_dir() {
            copy_files(&entry.path(), &to)?;
        } else if kind.is_file() && !to.try_exists()? {
            let temp = temporary(target);
            let result = fs::copy(entry.path(), &temp).and_then(|_| publish(&temp, &to));
            let _ = fs::remove_file(&temp);
            result?;
        }
    }
    Ok(())
}

fn imported(db: &Connection, source: &Path) -> rusqlite::Result<bool> {
    db.query_row(
        "SELECT 1 FROM app_storage_migrations WHERE source=?",
        [source.to_string_lossy().as_ref()],
        |_| Ok(true),
    )
    .optional()
    .map(|value| value.unwrap_or(false))
}

/// 迁移发生在任何业务连接打开之前。保留源文件，失败不标记完成，可在下次启动继续。
pub(super) fn prepare(root: &Path, sources: &[PathBuf]) -> io::Result<()> {
    fs::create_dir_all(root)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(root, fs::Permissions::from_mode(0o700))?;
    }
    let target = root.join("state.sqlite3");
    if !target.try_exists()? {
        for source in sources {
            let original = source.join("state.sqlite3");
            if !original.try_exists()? {
                continue;
            }
            let db = Connection::open_with_flags(original, OpenFlags::SQLITE_OPEN_READ_ONLY)
                .map_err(sql_error)?;
            db.busy_timeout(Duration::from_secs(5)).map_err(sql_error)?;
            let temp = temporary(root);
            // 与 Web 使用相同的 SQLite 快照方式，保留尚未 checkpoint 的已提交数据。
            let result = db
                .execute("VACUUM INTO ?", [temp.to_string_lossy().as_ref()])
                .map_err(sql_error)
                .and_then(|_| publish(&temp, &target));
            let _ = fs::remove_file(&temp);
            result?;
            break;
        }
    }
    let mut db = Connection::open(target).map_err(sql_error)?;
    super::super::sqlite_journal::enable_wal(&db).map_err(sql_error)?;
    db.execute_batch("PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;")
        .map_err(sql_error)?;
    let schema: Value = serde_json::from_str(include_str!(
        "../../../../packages/protocol/src/local-catalog-schema.json"
    ))?;
    let migration: Value = serde_json::from_str(include_str!(
        "../../../../packages/protocol/src/app-storage-migration.json"
    ))?;
    {
        let transaction = db
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(sql_error)?;
        transaction
            .execute_batch(
                schema["sql"]
                    .as_str()
                    .ok_or_else(|| io::Error::other("invalid storage schema"))?,
            )
            .map_err(sql_error)?;
        transaction
            .execute_batch(
                migration["normalizeProjectsSql"]
                    .as_str()
                    .ok_or_else(|| io::Error::other("invalid path normalization SQL"))?,
            )
            .map_err(sql_error)?;
        transaction.execute_batch("CREATE TABLE IF NOT EXISTS app_storage_migrations (source TEXT PRIMARY KEY) STRICT").map_err(sql_error)?;
        transaction.commit().map_err(sql_error)?;
    }
    for source in sources {
        if source == root || !source.try_exists()? || imported(&db, source).map_err(sql_error)? {
            continue;
        }
        copy_files(source, root)?;
        let original = ["state.sqlite3", "catalog.sqlite3"]
            .iter()
            .map(|name| source.join(name))
            .find(|path| path.is_file());
        if let Some(original) = &original {
            db.execute(
                "ATTACH DATABASE ? AS legacy",
                [original.to_string_lossy().as_ref()],
            )
            .map_err(sql_error)?;
        }
        let result = (|| {
            let transaction = db
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(sql_error)?;
            if !imported(&transaction, source).map_err(sql_error)? {
                if original.is_some() {
                    let has_catalog = transaction
                        .query_row(
                            "SELECT 1 FROM legacy.sqlite_master WHERE name='managed_projects'",
                            [],
                            |_| Ok(true),
                        )
                        .optional()
                        .map_err(sql_error)?
                        .unwrap_or(false);
                    if has_catalog {
                        remap::remap(
                            &transaction,
                            migration["projectMappingSql"]
                                .as_str()
                                .ok_or_else(|| io::Error::other("invalid project mapping SQL"))?,
                            source,
                            root,
                        )?;
                        transaction
                            .execute_batch(
                                migration["importSql"]
                                    .as_str()
                                    .ok_or_else(|| io::Error::other("invalid migration SQL"))?,
                            )
                            .map_err(sql_error)?;
                    }
                }
                transaction
                    .execute(
                        "INSERT INTO app_storage_migrations VALUES (?)",
                        [source.to_string_lossy().as_ref()],
                    )
                    .map_err(sql_error)?;
            }
            transaction.commit().map_err(sql_error)
        })();
        if original.is_some() {
            db.execute_batch("DETACH DATABASE legacy")
                .map_err(sql_error)?;
        }
        result?;
    }
    Ok(())
}

#[cfg(test)]
#[path = "app_data_migration_tests.rs"]
mod tests;
