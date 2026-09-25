mod child_exit;
mod control;
mod flow_control;
#[cfg(test)]
mod flow_control_tests;
mod input_queue;
#[cfg(test)]
mod input_queue_tests;
mod manager;
mod manager_io;
mod manager_operations;
mod manager_spawn;
pub use manager::TerminalManager;
#[cfg(test)]
mod manager_tests;
mod process_cleanup;
mod quota;
mod session;
mod shell;
#[cfg(feature = "webview-tests")]
mod test_metrics;
mod transport;
#[cfg(all(test, unix))]
mod transport_tests;
#[cfg(unix)]
mod unix_io;

#[cfg(test)]
mod tests {
    use super::quota::Quotas;
    use super::session::Session;

    #[test]
    fn shell_command_uses_validated_directory_and_platform_arguments() {
        let command = super::shell::command_for_root(&std::env::temp_dir()).unwrap();
        assert!(!command.get_argv().is_empty());
        assert!(
            super::shell::command_for_root(std::path::Path::new(
                "/missing-codeagent-terminal-root"
            ))
            .is_err()
        );
    }
    use crate::domain::project_terminal::TerminalError;

    #[cfg(unix)]
    #[test]
    fn real_session_closes_foreground_job_and_releases_workers() {
        let mut command = portable_pty::CommandBuilder::new("/bin/sh");
        command.args(["-c", "sleep 30"]);
        let session = Session::spawn(command, 80, 24).unwrap();
        session.resize(97, 31).unwrap();
        session.close().unwrap();
        session.close().unwrap();
        assert!(session.is_finished());
    }

    #[cfg(unix)]
    #[test]
    fn close_interrupts_a_reader_waiting_on_pty() {
        use std::{io::Read, sync::mpsc, time::Duration};
        let mut command = portable_pty::CommandBuilder::new("/bin/sh");
        command.args(["-c", "sleep 30"]);
        let session = Session::spawn(command, 80, 24).unwrap();
        let (mut reader, _writer) = session.take_io().unwrap();
        let (sender, receiver) = mpsc::channel();
        let worker = std::thread::spawn(move || {
            let _ = reader.read(&mut [0; 16]);
            sender.send(()).unwrap();
        });
        session.close().unwrap();
        receiver.recv_timeout(Duration::from_secs(1)).unwrap();
        worker.join().unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn reader_coalescing_wait_is_bounded_and_cancellable() {
        use std::time::{Duration, Instant};
        let mut command = portable_pty::CommandBuilder::new("/bin/sh");
        command.args(["-c", "sleep 30"]);
        let session = Session::spawn(command, 80, 24).unwrap();
        let (reader, _writer) = session.take_io().unwrap();
        let started = Instant::now();
        let ready = reader.read_ready(Duration::from_millis(4));
        session.cancel_io();
        let cancelled = reader.read_ready(Duration::from_secs(1));
        session.close().unwrap();
        assert!(!ready.unwrap());
        assert!(cancelled.is_err());
        assert!(started.elapsed() < Duration::from_secs(1));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn natural_exit_notifies_without_polling() {
        let mut command = portable_pty::CommandBuilder::new("/bin/sh");
        command.args(["-c", "exit 7"]);
        let session = Session::spawn(command, 80, 24).unwrap();
        assert_eq!(session.wait_exit().await.unwrap(), 7);
        session.close().unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn active_windows_session_closes_successfully_on_first_attempt() {
        let mut command = portable_pty::CommandBuilder::new("cmd.exe");
        command.args(["/D", "/Q"]);
        let session = Session::spawn(command, 80, 24).unwrap();
        let result = session.close();
        // Always retry cleanup before asserting so a RED run retains no child.
        if result.is_err() {
            let _ = session.close();
        }
        assert_eq!(result, Ok(()));
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn natural_windows_exit_can_be_cleaned_up_idempotently() {
        use std::{io::Read, io::Write, sync::mpsc, time::Duration};
        let mut command = portable_pty::CommandBuilder::new("cmd.exe");
        command.args(["/D", "/Q", "/C", "exit 7"]);
        let session = Session::spawn(command, 80, 24).unwrap();
        let (mut reader, mut writer) = session.take_io().unwrap();
        let (sender, receiver) = mpsc::sync_channel(1);
        let reader_worker = std::thread::spawn(move || {
            let mut bytes = [0; 64];
            let count = reader.read(&mut bytes).unwrap();
            sender.send(bytes[..count].to_vec()).unwrap();
        });
        let startup = receiver.recv_timeout(Duration::from_secs(3)).unwrap();
        assert!(startup.windows(4).any(|window| window == b"\x1b[6n"));
        writer.write_all(b"\x1b[1;1R").unwrap();
        writer.flush().unwrap();
        reader_worker.join().unwrap();
        assert_eq!(session.wait_exit().await.unwrap(), 7);
        drop(writer);
        session.close().unwrap();
        session.close().unwrap();
        assert!(session.is_finished());
        assert_eq!(session.exit_code(), Some(7));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn natural_shell_exit_still_reclaims_background_job_group() {
        use std::io::Read;
        let mut unrelated_command = portable_pty::CommandBuilder::new("/bin/sh");
        unrelated_command.args(["-c", "sleep 30"]);
        let unrelated = Session::spawn(unrelated_command, 80, 24).unwrap();
        let mut command = portable_pty::CommandBuilder::new("/bin/bash");
        command.args([
            "--noprofile",
            "--norc",
            "-mc",
            "trap '' HUP; sleep 30 & printf 'JOB:%s\\n' \"$!\"; exit",
        ]);
        let session = Session::spawn(command, 80, 24).unwrap();
        let (mut reader, _writer) = session.take_io().unwrap();
        let mut data = [0; 4096];
        let count = reader.read(&mut data).unwrap();
        let text = String::from_utf8_lossy(&data[..count]);
        let pid: i32 = text
            .split("JOB:")
            .nth(1)
            .unwrap()
            .split_whitespace()
            .next()
            .unwrap()
            .parse()
            .unwrap();
        session.wait_exit().await.unwrap();
        let ownership = std::process::Command::new("/bin/ps")
            .args(["-o", "pid=,ppid=,pgid=,sess=,stat=", "-p", &pid.to_string()])
            .output()
            .unwrap();
        session.close().unwrap();
        let status = std::process::Command::new("/bin/ps")
            .args(["-o", "stat=", "-p", &pid.to_string()])
            .output()
            .unwrap();
        let remains = status.status.success()
            && !String::from_utf8_lossy(&status.stdout)
                .trim()
                .starts_with('Z');
        // 失败也回收测试明确创建的子进程，避免泄漏影响下一轮验证。
        if remains {
            let _ = nix::sys::signal::kill(
                nix::unistd::Pid::from_raw(pid),
                nix::sys::signal::Signal::SIGKILL,
            );
        }
        let unrelated_exit = unrelated.exit_code();
        unrelated.close().unwrap();
        assert_eq!(unrelated_exit, None, "another terminal was terminated");
        assert!(
            !remains,
            "background job survived terminal close; ownership before close: {}",
            String::from_utf8_lossy(&ownership.stdout)
        );
    }

    #[test]
    fn reserves_project_and_global_limits_and_rolls_back_failed_creation() {
        let mut quotas = Quotas::default();
        for _ in 0..4 {
            quotas.reserve("a").unwrap();
        }
        assert_eq!(quotas.reserve("a"), Err(TerminalError::LimitReached));
        for _ in 0..4 {
            quotas.reserve("b").unwrap();
            quotas.reserve("c").unwrap();
        }
        assert_eq!(quotas.reserve("d"), Err(TerminalError::LimitReached));
        quotas.release("a");
        quotas.reserve("d").unwrap();
        assert_eq!(quotas.total(), 12);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn terminal_handles_return_to_baseline_after_one_hundred_cycles() {
        if std::env::var_os("CODEAGENT_TERMINAL_HANDLE_TEST_CHILD").is_none() {
            // 文件描述符是进程级指标；隔离测试进程，避免其他并行用例改变基线。
            let result = std::process::Command::new(std::env::current_exe().unwrap())
                .args(["--exact", "infrastructure::terminal::tests::terminal_handles_return_to_baseline_after_one_hundred_cycles", "--test-threads=1"])
                .env("CODEAGENT_TERMINAL_HANDLE_TEST_CHILD", "1")
                .output().unwrap();
            assert!(
                result.status.success(),
                "{}{}",
                String::from_utf8_lossy(&result.stdout),
                String::from_utf8_lossy(&result.stderr)
            );
            return;
        }
        let before = std::fs::read_dir("/dev/fd").unwrap().count();
        for _ in 0..100 {
            let mut command = portable_pty::CommandBuilder::new("/bin/sh");
            command.args(["-c", "sleep 30"]);
            let session = Session::spawn(command, 80, 24).unwrap();
            let (reader, writer) = session.take_io().unwrap();
            session.close().unwrap();
            drop((reader, writer, session));
        }
        let after = std::fs::read_dir("/dev/fd").unwrap().count();
        assert_eq!(after, before, "PTY descriptors did not return to baseline");
    }
}
