use rusqlite::{Connection, Error, ErrorCode};
use std::time::{Duration, Instant};

pub(super) fn enable_wal(db: &Connection) -> rusqlite::Result<()> {
    let timeout = Duration::from_secs(5);
    let deadline = Instant::now() + timeout;
    db.busy_timeout(Duration::ZERO)?;
    // SQLite can bypass its busy handler while upgrading journal locks.
    // Retry only this autocommit operation on the existing blocking worker.
    let result = loop {
        match db.execute_batch("PRAGMA journal_mode=WAL;") {
            Err(Error::SqliteFailure(error, _))
                if error.code == ErrorCode::DatabaseBusy && Instant::now() < deadline =>
            {
                std::thread::sleep(
                    Duration::from_millis(10)
                        .min(deadline.saturating_duration_since(Instant::now())),
                );
            }
            result => break result,
        }
    };
    db.busy_timeout(timeout)?;
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::OpenFlags;

    #[test]
    fn journal_retries_should_stop_at_the_deadline_and_restore_busy_timeout() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("state.sqlite3");
        let writer = Connection::open(&path).unwrap();
        writer
            .execute_batch("CREATE TABLE probe (id INTEGER); BEGIN IMMEDIATE;")
            .unwrap();
        let contender = Connection::open(&path).unwrap();
        let started = Instant::now();
        assert!(
            matches!(enable_wal(&contender), Err(Error::SqliteFailure(error, _)) if error.code == ErrorCode::DatabaseBusy)
        );
        assert!(started.elapsed() < Duration::from_secs(8));
        assert_eq!(
            contender
                .query_row("PRAGMA busy_timeout", [], |row| row.get::<_, i64>(0))
                .unwrap(),
            5_000
        );
    }

    #[test]
    fn journal_should_return_readonly_errors_without_retrying() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("state.sqlite3");
        let writer = Connection::open(&path).unwrap();
        writer
            .execute_batch("CREATE TABLE probe (id INTEGER)")
            .unwrap();
        drop(writer);
        let readonly =
            Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
        let started = Instant::now();
        assert!(
            matches!(enable_wal(&readonly), Err(Error::SqliteFailure(error, _)) if error.code == ErrorCode::ReadOnly)
        );
        assert!(started.elapsed() < Duration::from_secs(1));
    }
}
