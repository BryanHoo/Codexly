use super::{session::Session, transport::Transport};
use std::{
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::ipc::{Channel, InvokeResponseBody, Response};

#[cfg(unix)]
#[tokio::test]
async fn native_stream_preserves_binary_tail_and_joins_workers() {
    let mut command = portable_pty::CommandBuilder::new("/bin/sh");
    command.args(["-c", "printf 'terminal-stream-tail'"]);
    let session = Arc::new(Session::spawn(command, 80, 24).unwrap());
    let frames = Arc::new(Mutex::new(Vec::new()));
    let output = frames.clone();
    let channel = Channel::<Response>::new(move |body| {
        if let InvokeResponseBody::Raw(bytes) = body {
            output.lock().unwrap().push(bytes);
        } else {
            panic!("terminal output must be raw");
        }
        Ok(())
    });
    let transport = Transport::start(session.clone(), channel, Arc::new(|| {})).unwrap();
    assert_eq!(session.wait_exit().await.unwrap(), 0);
    assert!(transport.wait_reader(Duration::from_secs(1)));
    assert_eq!(transport.final_offset(), 20);
    let bytes: Vec<u8> = frames
        .lock()
        .unwrap()
        .iter()
        .flat_map(|frame| frame[16..].to_vec())
        .collect();
    assert_eq!(bytes, b"terminal-stream-tail");
    transport.cancel();
    session.close().unwrap();
    transport.join(Duration::from_secs(1)).unwrap();
}

#[cfg(unix)]
#[test]
fn native_output_stops_at_budget_and_resumes_without_losing_bytes() {
    use std::sync::mpsc;
    let mut command = portable_pty::CommandBuilder::new("/bin/sh");
    command.args(["-c", "dd if=/dev/zero bs=16384 count=64 2>/dev/null"]);
    let session = Arc::new(Session::spawn(command, 80, 24).unwrap());
    let (sender, receiver) = mpsc::sync_channel(32);
    let channel = Channel::<Response>::new(move |body| {
        let InvokeResponseBody::Raw(bytes) = body else {
            panic!("expected raw frame")
        };
        sender.try_send(bytes).unwrap();
        Ok(())
    });
    let transport = Transport::start(session.clone(), channel, Arc::new(|| {})).unwrap();
    let result = (|| {
        let mut offset = 0_u64;
        let mut sequence = 0_u64;
        while offset < 1024 * 1024 {
            let frame = receiver
                .recv_timeout(Duration::from_secs(2))
                .map_err(|error| error.to_string())?;
            sequence += 1;
            offset += (frame.len() - 16) as u64;
            assert_eq!(u64::from_le_bytes(frame[..8].try_into().unwrap()), sequence);
            assert_eq!(u64::from_le_bytes(frame[8..16].try_into().unwrap()), offset);
            assert!(frame[16..].iter().all(|byte| *byte == 0));
            if offset == 256 * 1024 {
                assert!(receiver.recv_timeout(Duration::from_millis(30)).is_err());
                assert_eq!(transport.outstanding_bytes(), 256 * 1024);
            }
            if offset >= 256 * 1024 {
                transport.ack(offset).unwrap();
            }
        }
        assert!(transport.wait_reader(Duration::from_secs(1)));
        assert_eq!(transport.final_offset(), 1024 * 1024);
        Ok::<(), String>(())
    })();
    // 断言结果在回收后报告，失败也不把测试 shell 留在系统中。
    transport.cancel();
    session.close().unwrap();
    transport.join(Duration::from_secs(1)).unwrap();
    result.unwrap();
}
