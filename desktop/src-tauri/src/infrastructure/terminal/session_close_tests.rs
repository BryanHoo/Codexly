use super::Session;
use portable_pty::CommandBuilder;
use std::io::Read;
use std::time::Duration;

#[test]
fn close_reaps_shell_with_unread_pty_output_on_first_attempt() {
    let mut command = CommandBuilder::new("/bin/zsh");
    command.args([
        "-f",
        "-i",
        "-c",
        "/bin/sh -c 'printf \"CLOSE_READY\\n\"; while true; do printf xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx; done'; :",
    ]);
    let session = Session::spawn(command, 80, 24).unwrap();
    let (mut reader, writer) = session.take_io().unwrap();
    let mut output = Vec::new();
    while !output.windows(11).any(|bytes| bytes == b"CLOSE_READY") {
        assert!(reader.read_ready(Duration::from_secs(3)).unwrap());
        let mut bytes = [0; 4096];
        let count = reader.read(&mut bytes).unwrap();
        assert!(count > 0 && output.len() < 65536);
        output.extend_from_slice(&bytes[..count]);
    }
    drop((reader, writer));
    // 模拟关闭时停止消费输出；macOS 的 slave 退出可能等待 master 排水或关闭。
    std::thread::sleep(Duration::from_millis(300));
    let result = session.close();
    // RED 阶段也必须释放 master，避免把退出中的测试进程留在系统里。
    session.master.lock().unwrap().take();
    let cleanup = session.close();
    assert_eq!(cleanup, Ok(()));
    assert_eq!(result, Ok(()), "first close failed with unread PTY output");
    assert!(session.is_finished());
}

#[test]
fn managed_close_releases_listening_port_workers_and_quota() {
    use crate::{
        domain::project_terminal::{CreateTerminalRequest, OUTPUT_HIGH_BYTES},
        infrastructure::terminal::{TerminalManager, transport::Transport},
    };
    use std::{
        net::TcpStream,
        sync::{Arc, mpsc},
    };
    let manager = TerminalManager::default();
    let reservation = manager
        .reserve(
            CreateTerminalRequest {
                project_id: "closing-test".into(),
                root_id: "r".into(),
                request_id: "q".into(),
                generation: manager.generation(),
                cols: 80,
                rows: 24,
            },
            1,
        )
        .unwrap();
    let mut command = CommandBuilder::new("/bin/zsh");
    // 使用随机本地端口；持续输出让真实传输进入背压，再模拟用户点击结束。
    command.args(["-f", "-i", "-c", "/usr/bin/python3 -u -c 'import socket,sys,time; s=socket.socket(); s.bind((\"127.0.0.1\",0)); s.listen(); print(\"LISTEN:\"+str(s.getsockname()[1])); sys.stdout.write(\"x\"*1048576); time.sleep(30)'; :"]);
    let session = Arc::new(Session::spawn(command, 80, 24).unwrap());
    let (sender, receiver) = mpsc::channel();
    let transport = Transport::start(
        session.clone(),
        tauri::ipc::Channel::new(move |body| {
            let tauri::ipc::InvokeResponseBody::Raw(bytes) = body else {
                panic!("expected raw output")
            };
            sender.send(bytes).unwrap();
            Ok(())
        }),
        Arc::new(|| {}),
    )
    .unwrap();
    let metadata = reservation
        .commit_with_transport(session.clone(), "zsh".into(), Some(transport.clone()))
        .unwrap();
    let observed = (|| {
        let mut output = Vec::new();
        while output.len() < OUTPUT_HIGH_BYTES as usize {
            let frame = receiver
                .recv_timeout(Duration::from_secs(5))
                .map_err(|error| error.to_string())?;
            output.extend_from_slice(&frame[16..]);
        }
        let text = String::from_utf8_lossy(&output);
        let port: u16 = text
            .split("LISTEN:")
            .nth(1)
            .and_then(|text| text.split_whitespace().next())
            .ok_or("listener marker missing")?
            .parse()
            .map_err(|error| format!("invalid port: {error}"))?;
        TcpStream::connect(("127.0.0.1", port)).map_err(|error| error.to_string())?;
        Ok::<_, String>(port)
    })();
    let result = manager.close(&metadata.scope);
    // 断言前兜底释放测试资源，确保失败运行也不残留监听服务。
    session.master.lock().unwrap().take();
    let cleanup = manager.close(&metadata.scope);
    assert_eq!(cleanup, Ok(()));
    let port = observed.unwrap();
    assert_eq!(result, Ok(()));
    transport.join(Duration::ZERO).unwrap();
    assert!(TcpStream::connect(("127.0.0.1", port)).is_err());
    assert_eq!(manager.live_count(), 0);
    manager.remove(&metadata.scope).unwrap();
    assert!(manager.snapshot().terminals.is_empty());
}
