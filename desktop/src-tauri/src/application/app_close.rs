use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::{
    DialogExt, MessageDialogButtons, MessageDialogKind, MessageDialogResult,
};

use super::app_lifecycle::MainWindowLifecycle;

const CLOSE_LABEL: &str = "关闭";
const MINIMIZE_LABEL: &str = "最小化";

#[derive(Default)]
pub(super) struct CloseConfirmation {
    pending: AtomicBool,
}

impl CloseConfirmation {
    fn begin(&self) -> bool {
        // 窗口按钮、托盘和快捷键共用门闩，弹窗及退出清理期间不重复处理。
        !self.pending.swap(true, Ordering::AcqRel)
    }

    fn reset(&self) {
        self.pending.store(false, Ordering::Release);
    }
}

#[derive(Debug, PartialEq, Eq)]
enum CloseChoice {
    Close,
    Minimize,
    Cancel,
}

fn close_choice(result: MessageDialogResult) -> CloseChoice {
    // 插件把各桌面平台的自定义按钮结果统一为标签；关闭弹窗和未知结果均按取消处理。
    match result {
        MessageDialogResult::Custom(label) if label == CLOSE_LABEL => CloseChoice::Close,
        MessageDialogResult::Custom(label) if label == MINIMIZE_LABEL => CloseChoice::Minimize,
        _ => CloseChoice::Cancel,
    }
}

pub(super) fn reset_close_confirmation(app: &AppHandle) {
    app.state::<MainWindowLifecycle>()
        .close_confirmation
        .reset();
}

pub(super) fn request_close_confirmation(app: &AppHandle) {
    if !app
        .state::<MainWindowLifecycle>()
        .close_confirmation
        .begin()
    {
        return;
    }

    let mut dialog = app.dialog()
        .message("是否关闭 Codexly？关闭将退出应用并结束所有本地终端及其运行中的程序；最小化将继续在后台运行。")
        .title("关闭 Codexly？")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::YesNoCancelCustom(
            CLOSE_LABEL.into(), MINIMIZE_LABEL.into(), "取消".into(),
        ));
    // 已最小化时使用独立系统弹窗，避免确认框被收进不可见的窗口。
    if let Some(window) = app.get_webview_window("main")
        && window.is_visible().unwrap_or(false)
        && !window.is_minimized().unwrap_or(true)
    {
        dialog = dialog.parent(&window);
    }
    let app = app.clone();
    dialog.show_with_result(move |result| match close_choice(result) {
        // 确认后才进入现有终端清理和存储落盘屏障，清理失败时重新开放关闭入口。
        CloseChoice::Close => app.exit(0),
        CloseChoice::Minimize => super::app_minimize::request_minimize(&app),
        CloseChoice::Cancel => reset_close_confirmation(&app),
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_explicit_close_and_minimize_buttons_perform_actions() {
        assert_eq!(
            close_choice(MessageDialogResult::Custom("关闭".into())),
            CloseChoice::Close
        );
        assert_eq!(
            close_choice(MessageDialogResult::Custom("最小化".into())),
            CloseChoice::Minimize
        );
        for result in [
            MessageDialogResult::Cancel,
            MessageDialogResult::Custom("取消".into()),
            MessageDialogResult::Custom("unknown".into()),
            MessageDialogResult::Ok,
        ] {
            assert_eq!(close_choice(result), CloseChoice::Cancel);
        }
    }

    #[test]
    fn repeated_requests_are_blocked_until_cancel_minimize_or_failure() {
        let confirmation = CloseConfirmation::default();
        assert!(confirmation.begin());
        assert!(!confirmation.begin());
        confirmation.reset();
        assert!(confirmation.begin());
        assert!(!confirmation.begin());
    }
}
