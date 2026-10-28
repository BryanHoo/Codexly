use std::io;

use tokio::process::Child;
use windows_process_platform::TerminalJob;

pub(super) async fn attach(child: &mut Child) -> io::Result<TerminalJob> {
    let result = child
        .id()
        .ok_or_else(|| io::Error::other("Codex process is unavailable"))
        .and_then(|pid| TerminalJob::assign(pid).map_err(io::Error::other));
    if result.is_err() {
        // 启动失败也不能留下占用安装目录的子进程。
        let _ = child.kill().await;
    }
    result
}
