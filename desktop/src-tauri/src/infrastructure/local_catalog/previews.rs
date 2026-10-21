use super::*;
use rusqlite::{OpenFlags, params};

pub(super) const SELECT: &str = "SELECT managed_tasks.*, (SELECT preview FROM managed_task_previews WHERE task_id=managed_tasks.id) AS preview FROM managed_tasks";

fn bounded(text: &str) -> String {
    text.trim()
        .lines()
        .next()
        .unwrap_or_default()
        .trim()
        .chars()
        .take(1024)
        .collect()
}

pub(super) fn write(db: &Connection, id: &str, text: &str) -> Result<usize, CatalogError> {
    let preview = bounded(text);
    if preview.is_empty() {
        return Ok(0);
    }
    // 首条输入只写一次，不修改正式名称或任务排序；并发删除也不会复活任务。
    db.execute("INSERT INTO managed_task_previews (task_id,preview) SELECT id,? FROM managed_tasks WHERE id=? ON CONFLICT(task_id) DO NOTHING", params![preview,id]).map_err(db_error)
}

pub(super) fn recover(db: &mut Connection, source_path: &Path) -> Result<usize, CatalogError> {
    let missing = db.prepare(&format!("{SELECT} WHERE provider='codex' AND title='' AND session_id IS NOT NULL AND preview IS NULL")).map_err(db_error)?
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(5)?))).map_err(db_error)?
        .collect::<rusqlite::Result<Vec<_>>>().map_err(db_error)?;
    if missing.is_empty() {
        return Ok(0);
    }
    // 只读原生索引的有界预览，按已绑定的 sessionId 查询；不读取或导入完整历史。
    let read = || -> rusqlite::Result<Vec<(String, String)>> {
        let source = Connection::open_with_flags(
            source_path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )?;
        source.busy_timeout(std::time::Duration::from_millis(100))?;
        let mut statement =
            source.prepare("SELECT substr(preview,1,1024) FROM threads WHERE id=?")?;
        let mut values = Vec::new();
        for (id, session) in missing {
            if let Some(text) = statement
                .query_row([session], |row| row.get::<_, String>(0))
                .optional()?
            {
                let preview = bounded(&text);
                if !preview.is_empty() {
                    values.push((id, preview));
                }
            }
        }
        Ok(values)
    };
    let Ok(values) = read() else {
        // 引擎缺失、索引被占用或版本不兼容不影响离线目录；下次打开存储时重试。
        return Ok(0);
    };
    let transaction = db.transaction().map_err(db_error)?;
    let mut written = 0;
    for (id, preview) in values {
        written += write(&transaction, &id, &preview)?;
    }
    transaction.commit().map_err(db_error)?;
    Ok(written)
}

pub(super) fn default_source() -> Option<PathBuf> {
    let nonempty = |key| {
        std::env::var_os(key)
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
    };
    nonempty("CODEX_SQLITE_HOME")
        .or_else(|| nonempty("CODEX_HOME"))
        .or_else(|| {
            nonempty(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
                .map(|home| home.join(".codex"))
        })
        .map(|home| home.join("state_5.sqlite"))
}
