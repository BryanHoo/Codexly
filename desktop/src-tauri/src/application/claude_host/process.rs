use std::time::Duration;
use tokio::process::{Child, Command};

/// 宿主崩溃或停止读取时，仍能回收其 SDK/工具后代；正常关闭先让 EOF 触发 SDK close。
pub(super) struct ProcessGuard {
    #[cfg(unix)]
    pid: i32,
    #[cfg(windows)]
    job: windows_process_platform::TerminalJob,
}

impl ProcessGuard {
    pub fn configure(command: &mut Command) {
        #[cfg(unix)]
        command.process_group(0);
        #[cfg(windows)]
        command.creation_flags(0x0800_0000);
    }

    pub fn attach(child: &Child) -> Result<Self, &'static str> {
        let pid = child.id().ok_or("Claude host process unavailable")?;
        Ok(Self {
            #[cfg(unix)]
            pid: i32::try_from(pid).map_err(|_| "Claude host process identity invalid")?,
            #[cfg(windows)]
            job: windows_process_platform::TerminalJob::assign(pid)
                .map_err(|_| "Claude host process job unavailable")?,
        })
    }

    pub fn terminate(&self) {
        #[cfg(unix)]
        {
            let result = nix::sys::signal::killpg(
                nix::unistd::Pid::from_raw(self.pid),
                nix::sys::signal::Signal::SIGKILL,
            );
            if result.is_err_and(|error| error != nix::errno::Errno::ESRCH) {
                crate::infrastructure::diagnostics::record_error(
                    "claude_host_process_cleanup_failed",
                    "process group termination failed",
                );
            }
        }
        #[cfg(windows)]
        if self.job.terminate().is_err() {
            crate::infrastructure::diagnostics::record_error(
                "claude_host_process_cleanup_failed",
                "process job termination failed",
            );
        }
    }

    pub async fn shutdown(&self, child: &mut Child) {
        // writer 已释放 stdin；先给运行时一个清理后台查询的机会，再兜底回收整个进程树。
        let _ = tokio::time::timeout(Duration::from_secs(3), child.wait()).await;
        self.terminate();
        let _ = child.start_kill();
        let _ = tokio::time::timeout(Duration::from_secs(1), child.wait()).await;
    }
}

impl Drop for ProcessGuard {
    fn drop(&mut self) {
        self.terminate();
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::process::Stdio;
    use tokio::io::{AsyncBufReadExt, BufReader};

    #[tokio::test]
    async fn process_guard_should_stop_background_descendants() {
        let directory = tempfile::tempdir().unwrap();
        let marker = directory.path().join("orphan-output");
        let mut command = Command::new("sh");
        command
            .args([
                "-c",
                "(sleep 0.3; touch \"$1\") & echo ready; exec sleep 60",
                "host-test",
            ])
            .arg(&marker)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        ProcessGuard::configure(&mut command);
        let mut child = command.spawn().unwrap();
        let guard = ProcessGuard::attach(&child).unwrap();
        // 确认后台进程已经创建，避免在 fork 之前杀宿主造成测试假阳性。
        let mut ready = String::new();
        tokio::time::timeout(
            Duration::from_secs(1),
            BufReader::new(child.stdout.take().unwrap()).read_line(&mut ready),
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(ready.trim(), "ready");
        guard.terminate();
        tokio::time::timeout(Duration::from_secs(1), child.wait())
            .await
            .unwrap()
            .unwrap();
        tokio::time::sleep(Duration::from_millis(450)).await;
        assert!(
            !marker.exists(),
            "background work must not survive the host"
        );
    }
}
