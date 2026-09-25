use portable_pty::{CommandBuilder, PtySize, native_pty_system};
use std::{
    io::{Read, Write},
    sync::mpsc,
    time::{Duration, Instant},
};

fn assert_shell_roundtrip(mut command: CommandBuilder) {
    let pair = native_pty_system()
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .unwrap();
    command.cwd(std::env::temp_dir());
    #[cfg(unix)]
    command.env("TERM", "xterm-256color");
    let mut child = pair.slave.spawn_command(command).unwrap();
    let mut killer = child.clone_killer();
    let (exit_sender, exit_receiver) = mpsc::sync_channel(1);
    let child_worker = std::thread::spawn(move || {
        let _ = exit_sender.send(child.wait());
    });
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader().unwrap();
    let (sender, receiver) = mpsc::sync_channel(16);
    let reader_worker = std::thread::spawn(move || {
        let mut total = 0;
        let mut buffer = [0; 4096];
        while let Ok(count) = reader.read(&mut buffer) {
            if count == 0 {
                break;
            }
            // 探针只传输 64 KiB；shell profile 输出也不能让测试无限缓存。
            total += count;
            if total > 65536 || sender.send(buffer[..count].to_vec()).is_err() {
                break;
            }
        }
    });
    let mut writer = pair.master.take_writer().unwrap();
    let mut output = Vec::new();
    #[cfg(windows)]
    {
        let startup_deadline = Instant::now() + Duration::from_secs(5);
        while !output.windows(4).any(|window| window == b"\x1b[6n") {
            let remaining = startup_deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                break;
            }
            match receiver.recv_timeout(remaining) {
                Ok(bytes) => output.extend(bytes),
                Err(_) => break,
            }
        }
        assert!(
            output.windows(4).any(|window| window == b"\x1b[6n"),
            "ConPTY did not request the initial cursor position: {output:?}"
        );
        writer.write_all(b"\x1b[1;1R").unwrap();
        writer.flush().unwrap();
    }
    #[cfg(unix)]
    writer
        .write_all(b"printf 'CODEAGENT_%s\\n' PTY_OK; exit\n")
        .unwrap();
    #[cfg(windows)]
    writer
        .write_all(b"echo CODEAGENT_PTY_OK\r\nexit\r\n")
        .unwrap();
    writer.flush().unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    while !output
        .windows(b"CODEAGENT_PTY_OK".len())
        .any(|window| window == b"CODEAGENT_PTY_OK")
    {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            break;
        }
        match receiver.recv_timeout(remaining) {
            Ok(bytes) => output.extend(bytes),
            Err(_) => break,
        }
    }
    let marker_found = String::from_utf8_lossy(&output).contains("CODEAGENT_PTY_OK");
    if !marker_found {
        let _ = killer.kill();
    }
    let status = exit_receiver.recv_timeout(Duration::from_secs(5));
    if status.is_err() {
        let _ = killer.kill();
    }
    drop(writer);
    drop(pair.master);
    reader_worker.join().unwrap();
    child_worker.join().unwrap();
    let output = String::from_utf8_lossy(&output);
    assert!(
        marker_found,
        "shell output did not contain marker: {output:?}"
    );
    assert!(
        status.unwrap().unwrap().success(),
        "shell output: {output:?}"
    );
}

#[test]
fn default_login_shell_accepts_input_and_exits() {
    assert_shell_roundtrip(CommandBuilder::new_default_prog());
}

#[cfg(unix)]
#[test]
fn bash_login_interactive_arguments_accept_input_and_exit() {
    let mut command = CommandBuilder::new("/bin/bash");
    command.args(["--login", "-i"]);
    assert_shell_roundtrip(command);
}

#[cfg(target_os = "macos")]
#[test]
fn zsh_login_interactive_arguments_accept_input_and_exit() {
    let mut command = CommandBuilder::new("/bin/zsh");
    command.args(["-l", "-i"]);
    assert_shell_roundtrip(command);
}

#[cfg(windows)]
#[test]
fn powershell_accepts_input_and_exits() {
    let system = std::env::var_os("SystemRoot").unwrap();
    let executable =
        std::path::PathBuf::from(system).join(r"System32\WindowsPowerShell\v1.0\powershell.exe");
    let mut command = CommandBuilder::new(executable);
    command.args(["-NoLogo", "-NoProfile"]);
    assert_shell_roundtrip(command);
}

#[cfg(windows)]
#[test]
fn cmd_accepts_input_and_exits() {
    let mut command = CommandBuilder::new("cmd.exe");
    command.args(["/D", "/Q"]);
    assert_shell_roundtrip(command);
}
