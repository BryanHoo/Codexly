use super::DiagnosticEvent;
use std::{
    fs::{self, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};

static DIRECTORY: OnceLock<PathBuf> = OnceLock::new();
static WRITE_LOCK: Mutex<()> = Mutex::new(());
const LIMIT: usize = 512 * 1024;

pub(super) fn initialize(directory: &Path) {
    let _ = DIRECTORY.set(directory.to_owned());
}

pub(super) fn persist(event: &DiagnosticEvent) {
    let Some(directory) = DIRECTORY.get() else {
        return;
    };
    // panic 可能发生在记录器内部；禁止等待同一把锁而导致崩溃处理死锁。
    let Ok(_guard) = WRITE_LOCK.try_lock() else {
        return;
    };
    if let Ok(mut bytes) = serde_json::to_vec(event) {
        bytes.push(b'\n');
        let _ = append(
            directory,
            &bytes,
            LIMIT,
            event.level == super::DiagnosticLevel::Error,
        );
    }
}

fn append(directory: &Path, bytes: &[u8], limit: usize, sync: bool) -> io::Result<()> {
    if bytes.len() > limit {
        return Ok(());
    }
    let path = directory.join("codeagent-emergency.log");
    if fs::metadata(&path).is_ok_and(|meta| meta.len() + bytes.len() as u64 > limit as u64) {
        let previous = directory.join("codeagent-emergency-previous.log");
        if previous.exists() {
            fs::remove_file(&previous)?;
        }
        fs::rename(&path, previous)?;
    }
    let mut file = OpenOptions::new().create(true).append(true).open(path)?;
    file.write_all(bytes)?;
    // 普通导航只同步提交给操作系统，避免 fsync 阻塞切换；严重故障额外请求持久化。
    if sync {
        file.sync_data()?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn journal_survives_process_exit_without_destructors() {
        const KEY: &str = "CODEXLY_TEST_EMERGENCY_DIRECTORY";
        if let Some(directory) = std::env::var_os(KEY) {
            super::append(
                std::path::Path::new(&directory),
                b"persisted-before-exit\n",
                256,
                false,
            )
            .unwrap();
            std::process::exit(23);
        }
        let directory = tempfile::tempdir().unwrap();
        let status = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "infrastructure::diagnostics::emergency::tests::journal_survives_process_exit_without_destructors"])
            .env(KEY, directory.path()).status().unwrap();
        assert_eq!(status.code(), Some(23));
        assert_eq!(
            std::fs::read(directory.path().join("codeagent-emergency.log")).unwrap(),
            b"persisted-before-exit\n"
        );
    }

    #[test]
    fn journal_rotates_without_exceeding_disk_budget() {
        let dir = tempfile::tempdir().unwrap();
        for _ in 0..20 {
            super::append(dir.path(), &[b'x'; 100], 256, true).unwrap();
        }
        let current = std::fs::read(dir.path().join("codeagent-emergency.log")).unwrap();
        let previous = std::fs::read(dir.path().join("codeagent-emergency-previous.log")).unwrap();
        assert!(current.len() <= 256);
        assert!(previous.len() <= 256);
    }
}
