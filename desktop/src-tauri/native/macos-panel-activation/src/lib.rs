mod minimize;
pub use minimize::exit_fullscreen_before_hide;

use objc2::{MainThreadMarker, msg_send, runtime::NSObjectProtocol as _, sel};
use objc2_app_kit::{NSApplication, NSEvent, NSPanel};
use objc2_foundation::NSProcessInfo;

const PRIMARY_MOUSE_BUTTON_MASK: usize = 1;

/// 检查 AppKit 的实时按键状态，避免释放事件早于原生拖拽会话启动。
pub fn primary_mouse_button_pressed() -> bool {
    NSEvent::pressedMouseButtons() & PRIMARY_MOUSE_BUTTON_MASK != 0
}

fn panel_can_become_key_window(application_is_active: bool) -> bool {
    application_is_active
}

pub fn application_is_active() -> bool {
    MainThreadMarker::new().is_some_and(|mtm| NSApplication::sharedApplication(mtm).isActive())
}

/// 在启动外部原生组件前读取系统能力边界，不通过额外子进程探测版本。
pub fn macos_major_version() -> isize {
    NSProcessInfo::processInfo().operatingSystemVersion().majorVersion
}

/// 仅在应用已经位于前台时允许面板获得键盘焦点，避免桌面宠物抢走其他应用的 key window。
pub fn can_become_key_window() -> bool {
    panel_can_become_key_window(application_is_active())
}

/// 补齐动态转换 NSPanel 时缺失的 macOS 防激活标记。
pub fn prevent_activation(panel: &NSPanel) {
    let selector = sel!(_setPreventsActivation:);
    if panel.respondsToSelector(selector) {
        // SAFETY: 已检查 selector，参数签名与 AppKit 的 BOOL setter 一致。
        unsafe {
            let _: () = msg_send![panel, _setPreventsActivation: true];
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn panel_only_accepts_key_focus_when_application_is_active() {
        assert!(!panel_can_become_key_window(false));
        assert!(panel_can_become_key_window(true));
    }
}
