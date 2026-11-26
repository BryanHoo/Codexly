use std::io;
use tokio::{
    io::AsyncReadExt, net::UnixListener, process::Command, task::JoinHandle, task::JoinSet,
};

/// 原生持有连接，硬退出时由内核关闭 socket；不依赖宿主执行析构或发送最后一帧。
pub(super) struct AcpLifetime {
    task: JoinHandle<()>,
    _directory: tempfile::TempDir,
}

impl AcpLifetime {
    pub fn new(command: &mut Command) -> io::Result<Self> {
        // TempDir 为私有目录；短文件名避免 macOS Unix socket 路径长度限制。
        let directory = tempfile::Builder::new().prefix("acp-").tempdir()?;
        let path = directory.path().join("l");
        let listener = UnixListener::bind(&path)?;
        command.env("CODEXLY_ACP_LIFETIME_SOCKET", &path);
        let task = tokio::spawn(async move {
            let mut clients = JoinSet::new();
            loop {
                tokio::select! {
                    client = listener.accept() => {
                        let Ok((mut stream, _)) = client else { break; };
                        if clients.len() >= 64 { continue; }
                        clients.spawn(async move {
                            // 通道无业务数据；EOF 或异常数据均结束该连接，关闭项及时释放容量。
                            let _ = stream.read(&mut [0u8; 1]).await;
                        });
                    }
                    _ = clients.join_next(), if !clients.is_empty() => {}
                }
            }
        });
        Ok(Self {
            task,
            _directory: directory,
        })
    }

    pub fn close(&self) {
        self.task.abort();
    }
}

impl Drop for AcpLifetime {
    fn drop(&mut self) {
        self.close();
    }
}
