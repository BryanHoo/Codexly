use super::{DiagnosticLevel, record, timestamp};
use serde_json::json;
use std::{
    collections::BTreeMap,
    fs::{self, OpenOptions},
    io::Write,
    path::Path,
    process::{Command, Stdio},
};
const WATCH_FLAG: &str = "--codexly-crash-watch";

pub(crate) fn observer_entry() -> bool {
    let args: Vec<_> = std::env::args_os().collect();
    if args.get(1).is_none_or(|value| value != WATCH_FLAG) {
        return false;
    }
    if args.len() != 5 {
        return true;
    }
    let Some(pid) = args[2]
        .to_str()
        .and_then(|value| value.parse::<u32>().ok())
        .filter(|pid| *pid != std::process::id())
    else {
        return true;
    };
    let Some(session) = args[4]
        .to_str()
        .filter(|value| value.len() == 24 && value.bytes().all(|byte| byte.is_ascii_hexdigit()))
    else {
        return true;
    };
    let directory = Path::new(&args[3]);
    let path = directory.join(format!("codeagent-host-{session}.log"));
    // 每个观察进程只有附着和退出两行，按宿主 session 命名避免并发 logger/轮转争用。
    let write = |event: &str, context: serde_json::Value| {
        if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) {
            let line = json!({"schemaVersion":1,"timestamp":timestamp(),"sessionId":session,"source":"rust","level":if event == "host_observer_attached" || (event == "host_process_exited" && context["exitCode"] == 0) { "info" } else { "error" },"event":event,"context":context});
            let _ = writeln!(file, "{line}");
            let _ = file.sync_all();
        }
    };
    let result = windows_process_platform::diagnostics::observe_process(pid, || {
        write("host_observer_attached", json!({"process":pid}))
    });
    match result {
        Ok(code) => write(
            "host_process_exited",
            json!({"exitCode":code,"exitCodeHex":format!("0x{code:08X}")}),
        ),
        Err(error) => write(
            "host_observer_failed",
            json!({"osError":error.raw_os_error()}),
        ),
    }
    true
}

pub(super) fn start_observer(directory: &Path) {
    static START: std::sync::Once = std::sync::Once::new();
    START.call_once(|| launch_observer(directory));
}

fn launch_observer(directory: &Path) {
    // 只清理本功能生成的固定格式文件；不触及其他日志或任意同前缀文件。
    if let Ok(entries) = fs::read_dir(directory) {
        let mut files: Vec<_> = entries
            .flatten()
            .filter(|entry| {
                entry.file_type().is_ok_and(|kind| kind.is_file())
                    && entry.file_name().to_str().is_some_and(|name| {
                        name.strip_prefix("codeagent-host-")
                            .and_then(|name| name.strip_suffix(".log"))
                            .is_some_and(|session| {
                                session.len() == 24
                                    && session.bytes().all(|byte| byte.is_ascii_hexdigit())
                            })
                    })
            })
            .collect();
        files.sort_by_key(|entry| entry.metadata().and_then(|meta| meta.modified()).ok());
        let remove = files.len().saturating_sub(7);
        for entry in files.into_iter().take(remove) {
            let _ = fs::remove_file(entry.path());
        }
    }
    let result = std::env::current_exe().and_then(|exe| {
        use std::os::windows::process::CommandExt;
        Command::new(exe)
            .args([WATCH_FLAG, &std::process::id().to_string()])
            .arg(directory)
            .arg(&super::session().id)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(0x0800_0000)
            .spawn()
    });
    if let Err(error) = result {
        super::record_error("host_observer_start_failed", error);
    }
}

pub(crate) fn observe_webview<R: tauri::Runtime>(webview: &tauri::Webview<R>) {
    let label = webview.label().to_owned();
    if let Err(error) = webview.with_webview(move |platform| {
        if let Err(error) = windows_process_platform::diagnostics::observe_webview(
            &label.clone(),
            platform.controller(),
            move |kind, reason, code| {
                record(
                    DiagnosticLevel::Error,
                    "webview_process_failed",
                    None,
                    BTreeMap::from([
                        ("window".into(), json!(label)),
                        ("failureKind".into(), json!(kind)),
                        ("reason".into(), json!(reason)),
                        ("exitCode".into(), json!(code)),
                    ]),
                );
            },
        ) {
            super::record_error("webview_observer_attach_failed", error);
        }
    }) {
        super::record_error("webview_observer_dispatch_failed", error);
    }
}
