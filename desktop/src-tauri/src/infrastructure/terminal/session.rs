use crate::domain::project_terminal::{TerminalError, validate_size};
use portable_pty::{CommandBuilder, MasterPty, PtySize, native_pty_system};
use std::{sync::Mutex, time::Duration};

pub(crate) trait TerminalReader: std::io::Read + Send {
    fn read_ready(&self, timeout: Duration) -> std::io::Result<bool>;
}

type TerminalIo = (Box<dyn TerminalReader>, Box<dyn std::io::Write + Send>);

#[cfg(windows)]
impl TerminalReader for Box<dyn std::io::Read + Send> {
    fn read_ready(&self, _timeout: Duration) -> std::io::Result<bool> {
        Ok(false)
    }
}

pub(crate) struct Session {
    #[cfg(windows)]
    job: windows_process_platform::TerminalJob,
    master: Mutex<Option<Box<dyn MasterPty + Send>>>,
    child: super::child_exit::ChildExit,
    size: Mutex<(u16, u16)>,
    close_lock: Mutex<()>,
    finished: std::sync::atomic::AtomicBool,
    #[cfg(unix)]
    wakers: Mutex<Vec<filedescriptor::FileDescriptor>>,
}

impl Session {
    #[cfg(feature = "webview-tests")]
    pub fn process_id(&self) -> u32 {
        self.child.pid
    }
    pub fn spawn(command: CommandBuilder, cols: u16, rows: u16) -> Result<Self, TerminalError> {
        validate_size(cols, rows)?;
        let pair = native_pty_system()
            .openpty(size(cols, rows))
            .map_err(|_| TerminalError::SpawnFailed)?;
        let child = pair
            .slave
            .spawn_command(command)
            .map_err(|_| TerminalError::SpawnFailed)?;
        #[cfg(windows)]
        let job = match child
            .process_id()
            .and_then(|pid| windows_process_platform::TerminalJob::assign(pid).ok())
        {
            Some(job) => job,
            None => {
                let mut child = child;
                let _ = child.kill();
                let _ = child.wait();
                return Err(TerminalError::SpawnFailed);
            }
        };
        drop(pair.slave);
        let child = super::child_exit::ChildExit::start(child)?;
        Ok(Self {
            #[cfg(windows)]
            job,
            master: Mutex::new(Some(pair.master)),
            child,
            size: Mutex::new((cols, rows)),
            close_lock: Mutex::new(()),
            finished: std::sync::atomic::AtomicBool::new(false),
            #[cfg(unix)]
            wakers: Mutex::new(Vec::new()),
        })
    }

    pub fn take_io(&self) -> Result<TerminalIo, TerminalError> {
        let master = self
            .master
            .lock()
            .map_err(|_| TerminalError::CleanupFailed)?;
        let master = master.as_ref().ok_or(TerminalError::NotFound)?;
        #[cfg(unix)]
        {
            let mut wakers = self
                .wakers
                .lock()
                .map_err(|_| TerminalError::CleanupFailed)?;
            if !wakers.is_empty() {
                return Err(TerminalError::RequestConflict);
            }
            let fd = master.as_raw_fd().ok_or(TerminalError::SpawnFailed)?;
            let (reader, read_wake) = super::unix_io::InterruptibleIo::new(fd)?;
            let (writer, write_wake) = super::unix_io::InterruptibleIo::new(fd)?;
            wakers.extend([read_wake, write_wake]);
            Ok((Box::new(reader), Box::new(writer)))
        }
        #[cfg(windows)]
        Ok((
            Box::new(
                master
                    .try_clone_reader()
                    .map_err(|_| TerminalError::SpawnFailed)?,
            ),
            master
                .take_writer()
                .map_err(|_| TerminalError::SpawnFailed)?,
        ))
    }

    pub fn cancel_io(&self) {
        #[cfg(unix)]
        if let Ok(mut wakers) = self.wakers.lock() {
            use std::io::Write;
            for waker in wakers.iter_mut() {
                let _ = waker.write(&[1]);
            }
        }
    }

    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), TerminalError> {
        validate_size(cols, rows)?;
        let mut current = self.size.lock().map_err(|_| TerminalError::CleanupFailed)?;
        if *current == (cols, rows) {
            return Ok(());
        }
        let master = self
            .master
            .lock()
            .map_err(|_| TerminalError::CleanupFailed)?;
        master
            .as_ref()
            .ok_or(TerminalError::NotFound)?
            .resize(size(cols, rows))
            .map_err(|_| TerminalError::StreamInvalid)?;
        *current = (cols, rows);
        Ok(())
    }

    pub fn is_finished(&self) -> bool {
        self.finished.load(std::sync::atomic::Ordering::Acquire)
    }

    pub async fn wait_exit(&self) -> Result<u32, TerminalError> {
        self.child.wait().await
    }

    pub fn exit_code(&self) -> Option<u32> {
        self.child.exit_code()
    }

    pub fn close(&self) -> Result<(), TerminalError> {
        let _closing = self
            .close_lock
            .lock()
            .map_err(|_| TerminalError::CleanupFailed)?;
        if self.is_finished() {
            return Ok(());
        }
        self.cancel_io();
        #[cfg(unix)]
        let tree = {
            let pid = self.child.pid;
            let foreground = self
                .master
                .lock()
                .map_err(|_| TerminalError::CleanupFailed)?
                .as_ref()
                .and_then(|master| master.process_group_leader());
            super::process_cleanup::ProcessTree::capture(pid, foreground)?
        };
        #[cfg(unix)]
        let hangup = tree.terminate(false);
        #[cfg(unix)]
        // 先保存前台进程组再释放 master；macOS 的 slave 退出可能等待未读输出排水。
        // 若等 child 退出后才关闭 master，shell 与前台作业会卡在退出状态并使 killpg 失败。
        self.master
            .lock()
            .map_err(|_| TerminalError::CleanupFailed)?
            .take();
        #[cfg(unix)]
        hangup?;
        #[cfg(windows)]
        self.job
            .terminate()
            .map_err(|_| TerminalError::CleanupFailed)?;
        #[cfg(unix)]
        self.child.wait_timeout(Duration::from_secs(2))?;
        #[cfg(unix)]
        tree.terminate(true)?;
        if !self.child.wait_timeout(Duration::from_millis(800))? {
            return Err(TerminalError::CleanupFailed);
        }
        self.child.join()?;
        #[cfg(windows)]
        self.master
            .lock()
            .map_err(|_| TerminalError::CleanupFailed)?
            .take();
        self.finished
            .store(true, std::sync::atomic::Ordering::Release);
        Ok(())
    }
}

fn size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        cols,
        rows,
        pixel_width: 0,
        pixel_height: 0,
    }
}

#[cfg(all(test, target_os = "macos"))]
#[path = "session_close_tests.rs"]
mod tests;
