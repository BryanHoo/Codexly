use std::time::Duration;
use tokio::process::{Child, Command};

/// 宿主崩溃或停止读取时，仍能回收其 SDK/工具后代；正常关闭先让 EOF 触发 SDK close。
pub(super) struct ProcessGuard {
    #[cfg(unix)]
    pid: Option<i32>,
    #[cfg(unix)]
    lifetime: super::lifetime::AcpLifetime,
    #[cfg(windows)]
    job: Option<windows_process_platform::TerminalJob>,
}

impl ProcessGuard {
    pub fn configure(command: &mut Command) -> Result<Self, &'static str> {
        #[cfg(unix)]
        command.process_group(0);
        #[cfg(windows)]
        command.creation_flags(0x0800_0000);
        Ok(Self {
            #[cfg(unix)]
            pid: None,
            #[cfg(unix)]
            lifetime: super::lifetime::AcpLifetime::new(command)
                .map_err(|_| "Agent lifetime channel unavailable")?,
            #[cfg(windows)]
            job: None,
        })
    }

    pub fn attach(mut self, child: &Child) -> Result<Self, &'static str> {
        let pid = child.id().ok_or("Claude host process unavailable")?;
        #[cfg(unix)]
        {
            self.pid =
                Some(i32::try_from(pid).map_err(|_| "Claude host process identity invalid")?);
        }
        #[cfg(windows)]
        {
            self.job = Some(
                windows_process_platform::TerminalJob::assign(pid)
                    .map_err(|_| "Claude host process job unavailable")?,
            );
        }
        Ok(self)
    }

    pub fn terminate(&self) {
        #[cfg(unix)]
        {
            self.lifetime.close();
            let Some(pid) = self.pid else {
                return;
            };
            let result = nix::sys::signal::killpg(
                nix::unistd::Pid::from_raw(pid),
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
        if self
            .job
            .as_ref()
            .is_some_and(|job| job.terminate().is_err())
        {
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
    async fn native_lifetime_should_close_connected_agents_without_polling() {
        use tokio::{io::AsyncReadExt, net::UnixStream};
        let mut command = Command::new("sh");
        let lifetime = super::super::lifetime::AcpLifetime::new(&mut command).unwrap();
        let path = command
            .as_std()
            .get_envs()
            .find(|(key, _)| *key == "CODEXLY_ACP_LIFETIME_SOCKET")
            .and_then(|(_, value)| value)
            .unwrap();
        let mut connection = UnixStream::connect(path).await.unwrap();
        let mut bytes = [0u8; 1];
        assert!(
            tokio::time::timeout(Duration::from_millis(20), connection.read(&mut bytes))
                .await
                .is_err()
        );
        lifetime.close();
        let result = tokio::time::timeout(Duration::from_secs(1), connection.read(&mut bytes))
            .await
            .unwrap();
        assert!(matches!(result, Ok(0) | Err(_)));
    }

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
        let guard = ProcessGuard::configure(&mut command).unwrap();
        let mut child = command.spawn().unwrap();
        let guard = guard.attach(&child).unwrap();
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
