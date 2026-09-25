use crate::domain::project_terminal::encode_frame;
use portable_pty::{CommandBuilder, PtySize, native_pty_system};
use std::{
    io::{Read, Write},
    sync::{Arc, Mutex, mpsc},
    time::Duration,
};
use tauri::ipc::{Channel, Response};

pub(super) fn fixture_root(project_id: &str, root_id: &str) -> Option<std::path::PathBuf> {
    // 仅原生测试模式识别固定 fixture；生产构建不包含此项目查询替代入口。
    if std::env::var("CODEAGENT_WEBVIEW_TEST").as_deref() != Ok("1") {
        return None;
    }
    match (project_id, root_id) {
        ("codeagent", "root-codeagent")
        | ("codexly", "root-codexly")
        | ("terminal-bench-third", "root-terminal-bench-third") => {
            std::env::temp_dir().canonicalize().ok()
        }
        _ => None,
    }
}

#[tauri::command]
pub fn inspect_project_terminal_test(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, super::state::AppState>,
) -> Result<serde_json::Value, String> {
    if window.label() != "main" || std::env::var("CODEAGENT_WEBVIEW_TEST").as_deref() != Ok("1") {
        return Err("TERMINAL_SCOPE_MISMATCH".into());
    }
    Ok(state.terminals.test_metrics())
}

// 此模块只编入 webview-tests，固定命令不接受前端 cwd、程序或环境配置。
#[tauri::command]
pub async fn probe_terminal_protocol(
    window: tauri::WebviewWindow,
    on_output: Channel<Response>,
) -> Result<(u16, u16), String> {
    if window.label() != "main" {
        return Err("TERMINAL_SCOPE_MISMATCH".into());
    }
    tauri::async_runtime::spawn_blocking(move || probe(on_output))
        .await
        .map_err(|_| "probe worker failed".to_string())?
}

fn probe(output: Channel<Response>) -> Result<(u16, u16), String> {
    let pair = native_pty_system()
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;
    pair.master
        .resize(PtySize {
            rows: 31,
            cols: 97,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;
    #[cfg(unix)]
    let mut command = CommandBuilder::new("/bin/sh");
    #[cfg(unix)]
    command.args(["-c", "stty size; read -r line; printf '%s\\n' \"$line\""]);
    #[cfg(windows)]
    let mut command = CommandBuilder::new("cmd.exe");
    #[cfg(windows)]
    command.args(["/D", "/Q"]);
    command.cwd(std::env::temp_dir());
    let mut child = pair
        .slave
        .spawn_command(command)
        .map_err(|e| e.to_string())?;
    drop(pair.slave);
    let setup = (|| {
        let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
        let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
        let size = pair.master.get_size().map_err(|e| e.to_string())?;
        Ok::<_, String>((writer, reader, size))
    })();
    let (writer, mut reader, size) = match setup {
        Ok(setup) => setup,
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }
    };
    let mut killer = child.clone_killer();
    let (child_sender, child_receiver) = mpsc::sync_channel(1);
    let child_worker = std::thread::spawn(move || {
        let _ = child_sender.send(child.wait().map_err(|error| error.to_string()));
    });
    let writer = Arc::new(Mutex::new(writer));
    #[cfg(windows)]
    let response_writer = writer.clone();
    #[cfg(windows)]
    let (startup_sender, startup_receiver) = mpsc::sync_channel(1);
    let (reader_sender, reader_receiver) = mpsc::sync_channel(1);
    let reader_worker = std::thread::spawn(move || {
        let result = (|| {
            let mut buffer = [0u8; 16384];
            let marker = b"CODEAGENT_PTY_OK";
            let mut marker_tail = Vec::with_capacity(marker.len() * 2);
            #[cfg(windows)]
            let mut dsr_tail = Vec::with_capacity(8);
            #[cfg(windows)]
            let mut startup_reported = false;
            let mut sequence = 0;
            let mut offset = 0;
            loop {
                let count = match reader.read(&mut buffer) {
                    Ok(count) => count,
                    #[cfg(unix)]
                    Err(error) if error.raw_os_error() == Some(5) => 0,
                    Err(error) => return Err(error.to_string()),
                };
                if count == 0 {
                    break;
                }
                sequence += 1;
                offset += count as u64;
                let frame =
                    encode_frame(sequence, offset, &buffer[..count]).map_err(|e| e.to_string())?;
                output
                    .send(Response::new(frame))
                    .map_err(|e| e.to_string())?;
                marker_tail.extend_from_slice(&buffer[..count]);
                #[cfg(windows)]
                {
                    dsr_tail.extend_from_slice(&buffer[..count]);
                    let responses = dsr_tail
                        .windows(4)
                        .filter(|window| *window == b"\x1b[6n")
                        .count();
                    if responses > 0 {
                        let mut writer = response_writer
                            .lock()
                            .map_err(|_| "probe writer lock failed".to_owned())?;
                        for _ in 0..responses {
                            writer.write_all(b"\x1b[1;1R").map_err(|e| e.to_string())?;
                        }
                        writer.flush().map_err(|e| e.to_string())?;
                        if !startup_reported {
                            startup_sender
                                .send(())
                                .map_err(|_| "probe startup receiver closed".to_owned())?;
                            startup_reported = true;
                        }
                    }
                    if dsr_tail.len() >= 4 {
                        dsr_tail.drain(..dsr_tail.len() - 3);
                    }
                }
                if marker_tail
                    .windows(marker.len())
                    .any(|window| window == marker)
                {
                    return Ok(());
                }
                if marker_tail.len() >= marker.len() {
                    marker_tail.drain(..marker_tail.len() - (marker.len() - 1));
                }
            }
            Err("probe output ended before marker".to_owned())
        })();
        let _ = reader_sender.send(result);
    });
    #[cfg(windows)]
    let startup_result = startup_receiver
        .recv_timeout(Duration::from_secs(3))
        .map_err(|_| "probe startup timed out".to_owned());
    #[cfg(unix)]
    let startup_result = Ok(());
    let write_result = startup_result.and_then(|()| {
        let mut writer = writer
            .lock()
            .map_err(|_| "probe writer lock failed".to_owned())?;
        #[cfg(unix)]
        writer
            .write_all(b"CODEAGENT_PTY_OK\n")
            .map_err(|e| e.to_string())?;
        #[cfg(windows)]
        writer
            .write_all(b"echo CODEAGENT_PTY_OK\r\nexit\r\n")
            .map_err(|e| e.to_string())?;
        writer.flush().map_err(|e| e.to_string())
    });
    drop(writer);
    let reader_result = match write_result {
        Ok(()) => reader_receiver
            .recv_timeout(Duration::from_secs(3))
            .map_err(|_| "probe output timed out".to_owned())
            .and_then(std::convert::identity),
        Err(error) => Err(error),
    };
    if reader_result.is_err() {
        let _ = killer.kill();
    }
    let mut child_result = child_receiver
        .recv_timeout(Duration::from_secs(3))
        .map_err(|_| "probe shell timed out".to_owned())
        .and_then(std::convert::identity);
    if child_result.is_err() {
        let _ = killer.kill();
    }
    drop(pair.master);
    if child_result.is_err()
        && let Ok(result) = child_receiver.recv_timeout(Duration::from_secs(1))
    {
        child_result = result;
    }
    reader_worker
        .join()
        .map_err(|_| "probe reader failed".to_owned())?;
    child_worker
        .join()
        .map_err(|_| "probe child worker failed".to_owned())?;
    reader_result?;
    if !child_result?.success() {
        return Err("probe shell failed".into());
    }
    Ok((size.rows, size.cols))
}
