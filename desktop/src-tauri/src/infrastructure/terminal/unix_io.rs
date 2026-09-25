use crate::domain::project_terminal::TerminalError;
use filedescriptor::{FileDescriptor, POLLIN, POLLOUT, poll, pollfd, socketpair};
use std::{
    io::{self, Read, Write},
    os::fd::{AsRawFd, RawFd},
    time::{Duration, Instant},
};

struct BorrowedMaster(RawFd);
impl AsRawFd for BorrowedMaster {
    fn as_raw_fd(&self) -> RawFd {
        self.0
    }
}

pub(super) struct InterruptibleIo {
    fd: FileDescriptor,
    wake: FileDescriptor,
}

impl InterruptibleIo {
    pub fn new(master: RawFd) -> Result<(Self, FileDescriptor), TerminalError> {
        let mut fd =
            FileDescriptor::dup(&BorrowedMaster(master)).map_err(|_| TerminalError::SpawnFailed)?;
        fd.set_non_blocking(true)
            .map_err(|_| TerminalError::SpawnFailed)?;
        let (wake, mut sender) = socketpair().map_err(|_| TerminalError::SpawnFailed)?;
        sender
            .set_non_blocking(true)
            .map_err(|_| TerminalError::SpawnFailed)?;
        Ok((Self { fd, wake }, sender))
    }

    fn wait(&self, events: i16, timeout: Option<Duration>) -> io::Result<bool> {
        let deadline = timeout.map(|timeout| Instant::now() + timeout);
        let mut descriptors = [
            pollfd {
                fd: self.fd.as_raw_fd(),
                events,
                revents: 0,
            },
            pollfd {
                fd: self.wake.as_raw_fd(),
                events: POLLIN,
                revents: 0,
            },
        ];
        // PTY 就绪与关闭通知共享一次阻塞等待，空闲不创建周期唤醒。
        loop {
            let remaining =
                deadline.map(|deadline| deadline.saturating_duration_since(Instant::now()));
            match poll(&mut descriptors, remaining) {
                Ok(_) if descriptors[1].revents != 0 => {
                    return Err(io::Error::new(
                        io::ErrorKind::BrokenPipe,
                        "terminal I/O cancelled",
                    ));
                }
                Ok(_) => return Ok(descriptors[0].revents != 0),
                Err(filedescriptor::Error::Io(error))
                    if error.kind() == io::ErrorKind::Interrupted => {}
                Err(error) => return Err(io::Error::other(error)),
            }
        }
    }
}

impl super::session::TerminalReader for InterruptibleIo {
    fn read_ready(&self, timeout: Duration) -> io::Result<bool> {
        self.wait(POLLIN, Some(timeout))
    }
}

impl Read for InterruptibleIo {
    fn read(&mut self, bytes: &mut [u8]) -> io::Result<usize> {
        loop {
            self.wait(POLLIN, None)?;
            match self.fd.read(bytes) {
                Err(error)
                    if error.kind() == io::ErrorKind::WouldBlock
                        || error.kind() == io::ErrorKind::Interrupted => {}
                Err(error) if error.raw_os_error() == Some(5) => return Ok(0),
                result => return result,
            }
        }
    }
}
impl Write for InterruptibleIo {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        loop {
            self.wait(POLLOUT, None)?;
            match self.fd.write(bytes) {
                Err(error)
                    if error.kind() == io::ErrorKind::WouldBlock
                        || error.kind() == io::ErrorKind::Interrupted => {}
                result => return result,
            }
        }
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}
