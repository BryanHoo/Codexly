use tauri::{AppHandle, Manager};

pub(super) fn request_minimize(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        super::app_close::reset_close_confirmation(app);
        return;
    };
    #[cfg(target_os = "macos")]
    {
        let operation_app = app.clone();
        // AppKit 的窗口操作及全屏完成通知均在主线程执行，完成前保留关闭门闩。
        if let Err(error) = app.run_on_main_thread(move || {
            let completed_app = operation_app.clone();
            let hide_window = window.clone();
            let result = macos_panel_activation::exit_fullscreen_before_hide(
                &window.as_ref().window(),
                move || {
                    if let Err(error) = hide_window.hide() {
                        report_minimize_failure(&completed_app, error);
                        return;
                    }
                    if let Err(error) = completed_app.set_dock_visibility(false) {
                        crate::infrastructure::diagnostics::record_error(
                            "main_window_dock_hide_failed",
                            error,
                        );
                    }
                    super::app_close::reset_close_confirmation(&completed_app);
                },
            );
            if let Err(error) = result {
                report_minimize_failure(&operation_app, error);
            }
        }) {
            report_minimize_failure(app, error);
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        if let Err(error) = window.hide() {
            report_minimize_failure(app, error);
        } else {
            super::app_close::reset_close_confirmation(app);
        }
    }
}

fn report_minimize_failure(app: &AppHandle, error: impl std::fmt::Display) {
    crate::infrastructure::diagnostics::record_error("main_window_minimize_failed", error);
    super::app_close::reset_close_confirmation(app);
}
