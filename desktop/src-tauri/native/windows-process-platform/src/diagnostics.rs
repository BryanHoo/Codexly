//! Windows 诊断的原生边界；宿主 crate 继续禁止 unsafe。
use std::io;
use std::{cell::RefCell, collections::HashMap};
use webview2_com::{Microsoft::Web::WebView2::Win32::*, ProcessFailedEventHandler};
use windows::Win32::{
    Foundation::{CloseHandle, WAIT_OBJECT_0},
    System::Threading::{
        GetExitCodeProcess, INFINITE, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
        PROCESS_SYNCHRONIZE, WaitForSingleObject,
    },
};
use windows_core::Interface;
thread_local! {
    // 每个标签只保留一个 handler；页面重载替换，窗口销毁移除，不累计 COM 资源。
    static OBSERVERS: RefCell<HashMap<String, (ICoreWebView2, i64)>> = RefCell::new(HashMap::new());
}

pub fn forget_webview(label: &str) {
    OBSERVERS.with(|observers| {
        if let Some((view, token)) = observers.borrow_mut().remove(label) {
            // SAFETY: 在创建 control 的 UI 线程执行，token 来自此 control 的注册结果。
            let _ = unsafe { view.remove_ProcessFailed(token) };
        }
    });
}

/// 仅请求同步与退出状态权限；在独立进程等待，宿主堆损坏也不影响此处记录。
pub fn observe_process(pid: u32, attached: impl FnOnce()) -> io::Result<u32> {
    // SAFETY: PID 来自已校验的宿主参数；句柄只在此函数持有，所有路径均关闭。
    unsafe {
        let handle = OpenProcess(
            PROCESS_SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION,
            false,
            pid,
        )
        .map_err(io::Error::other)?;
        attached();
        let result = if WaitForSingleObject(handle, INFINITE) == WAIT_OBJECT_0 {
            let mut code = 0;
            GetExitCodeProcess(handle, &mut code)
                .map(|()| code)
                .map_err(io::Error::other)
        } else {
            Err(io::Error::last_os_error())
        };
        let _ = CloseHandle(handle);
        result
    }
}

/// WebView 自身持有事件 handler；释放 control 时释放回调，不捕获 control 形成引用环。
pub fn observe_webview(
    label: &str,
    controller: ICoreWebView2Controller,
    report: impl Fn(i32, Option<i32>, Option<i32>) + 'static,
) -> Result<(), String> {
    // SAFETY: 调用方经 Tauri with_webview 在对应 COM apartment 执行；输出参数均有效。
    unsafe {
        let view = controller
            .CoreWebView2()
            .map_err(|error| error.to_string())?;
        let handler = ProcessFailedEventHandler::create(Box::new(move |_, args| {
            if let Some(args) = args {
                let mut kind = COREWEBVIEW2_PROCESS_FAILED_KIND::default();
                args.ProcessFailedKind(&mut kind)?;
                let (mut reason, mut code) = (COREWEBVIEW2_PROCESS_FAILED_REASON::default(), 0);
                let details = args.cast::<ICoreWebView2ProcessFailedEventArgs2>().ok();
                let reason = details
                    .as_ref()
                    .and_then(|args| args.Reason(&mut reason).ok().map(|()| reason.0));
                let code = details
                    .as_ref()
                    .and_then(|args| args.ExitCode(&mut code).ok().map(|()| code));
                report(kind.0, reason, code);
            }
            Ok(())
        }));
        let mut token = 0;
        view.add_ProcessFailed(&handler, &mut token)
            .map_err(|error| error.to_string())?;
        forget_webview(label);
        OBSERVERS.with(|observers| {
            observers
                .borrow_mut()
                .insert(label.to_owned(), (view, token));
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::{
        io::Write,
        process::{Command, Stdio},
    };

    #[test]
    fn observer_records_exit_after_the_handle_is_attached() {
        // 子进程等待输入，保证先取得句柄，再允许退出，避免靠 sleep 制造测试时序。
        let mut child = Command::new("cmd.exe")
            .args(["/D", "/C", "set /p input= & exit 37"])
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let input = child.stdin.take();
        let code = super::observe_process(child.id(), move || {
            if let Some(mut input) = input {
                input.write_all(b"ready\n").unwrap();
            }
        })
        .unwrap();
        assert_eq!(code, 37);
        child.wait().unwrap();
    }

    #[test]
    fn observer_reports_access_failure_instead_of_waiting_forever() {
        assert!(super::observe_process(0, || panic!("must not attach")).is_err());
    }
}
