#[cfg(unix)]
use crate::domain::project_terminal::TerminalError;

#[cfg(unix)]
pub(super) struct ProcessTree {
    groups: Vec<i32>,
}

#[cfg(unix)]
impl ProcessTree {
    pub fn capture(pid: u32, foreground: Option<i32>) -> Result<Self, TerminalError> {
        use std::{
            collections::HashSet,
            io::Read,
            process::{Command, Stdio},
        };
        let root = i32::try_from(pid).map_err(|_| TerminalError::CleanupFailed)?;
        let columns = if cfg!(target_os = "linux") {
            "pid=,ppid=,pgid=,sid="
        } else {
            "pid=,ppid=,pgid="
        };
        let mut process = Command::new("/bin/ps")
            .args(["-axo", columns])
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|_| TerminalError::CleanupFailed)?;
        let mut data = String::new();
        let read = process
            .stdout
            .take()
            .ok_or(TerminalError::CleanupFailed)?
            .take(1024 * 1024 + 1)
            .read_to_string(&mut data);
        if read.is_err() || data.len() > 1024 * 1024 {
            let _ = process.kill();
            let _ = process.wait();
            return Err(TerminalError::CleanupFailed);
        }
        if !process
            .wait()
            .map_err(|_| TerminalError::CleanupFailed)?
            .success()
        {
            return Err(TerminalError::CleanupFailed);
        }
        let entries: Vec<(i32, i32, i32, i32)> = data
            .lines()
            .filter_map(|line| {
                let mut fields = line.split_whitespace();
                Some((
                    fields.next()?.parse().ok()?,
                    fields.next()?.parse().ok()?,
                    fields.next()?.parse().ok()?,
                    fields
                        .next()
                        .and_then(|field| field.parse().ok())
                        .unwrap_or(0),
                ))
            })
            .collect();
        let mut owned = HashSet::from([root]);
        // Linux 重新收养退出 shell 的后台作业后，PPID 已改变，但 PTY 的 SID 仍保留。
        owned.extend(
            entries
                .iter()
                .filter(|entry| entry.3 == root)
                .map(|entry| entry.0),
        );
        loop {
            let before = owned.len();
            for (id, parent, _, _) in &entries {
                if owned.contains(parent) {
                    owned.insert(*id);
                }
            }
            if before == owned.len() {
                break;
            }
        }
        let own_group = nix::unistd::getpgrp().as_raw();
        let mut groups = HashSet::from([root]);
        if let Some(group) = foreground {
            groups.insert(group);
        }
        for (id, _, group, _) in entries {
            if owned.contains(&id) {
                groups.insert(group);
            }
        }
        // 只回收该 PTY 的组，绝不允许无效 PID 或应用自己的进程组进入信号目标。
        if groups
            .iter()
            .any(|group| *group <= 1 || *group == own_group)
        {
            return Err(TerminalError::CleanupFailed);
        }
        Ok(Self {
            groups: groups.into_iter().collect(),
        })
    }

    pub fn terminate(&self, force: bool) -> Result<(), TerminalError> {
        use nix::{
            errno::Errno,
            sys::signal::{Signal, killpg},
            unistd::Pid,
        };
        let deadline = std::time::Instant::now() + std::time::Duration::from_millis(200);
        for group in &self.groups {
            loop {
                match killpg(
                    Pid::from_raw(*group),
                    if force {
                        Signal::SIGKILL
                    } else {
                        Signal::SIGHUP
                    },
                ) {
                    Ok(()) | Err(Errno::ESRCH) => break,
                    // macOS 对退出中的进程组短暂返回 EPERM；等待其消失，不吞掉真实权限错误。
                    // 所有组共用关闭阶段的有界预算，不增加运行期间的轮询。
                    Err(Errno::EPERM) if std::time::Instant::now() < deadline => {
                        std::thread::sleep(std::time::Duration::from_millis(5));
                    }
                    Err(_) => return Err(TerminalError::CleanupFailed),
                }
            }
        }
        Ok(())
    }
}
