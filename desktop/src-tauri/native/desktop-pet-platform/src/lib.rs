#[cfg(any(target_os = "linux", test))]
fn linux_backend_preference(
    session_type: Option<&str>,
    has_wayland_display: bool,
) -> Option<&'static str> {
    (has_wayland_display || session_type.is_some_and(|value| value.eq_ignore_ascii_case("wayland")))
        .then_some("x11,wayland")
}

#[cfg(any(target_os = "windows", test))]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum DesktopFollowAction {
    Move,
    Stop,
    Wait,
}

#[cfg(any(target_os = "windows", test))]
fn desktop_follow_action(
    window_is_valid: bool,
    window_is_on_current_desktop: bool,
    target_desktop_is_available: bool,
) -> DesktopFollowAction {
    if !window_is_valid {
        DesktopFollowAction::Stop
    } else if !window_is_on_current_desktop && target_desktop_is_available {
        DesktopFollowAction::Move
    } else {
        DesktopFollowAction::Wait
    }
}

#[cfg(target_os = "windows")]
mod windows_overlay {
    use std::{ffi::c_void, thread, time::Duration};

    use windows::{
        core::Result,
        Win32::{
            Foundation::HWND,
            System::Com::{
                CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
                COINIT_APARTMENTTHREADED,
            },
            UI::{
                Shell::{IVirtualDesktopManager, VirtualDesktopManager},
                WindowsAndMessaging::{
                    GetForegroundWindow, IsWindow, SetWindowPos, HWND_TOPMOST, SWP_NOACTIVATE,
                    SWP_NOMOVE, SWP_NOSIZE,
                },
            },
        },
    };

    use super::{desktop_follow_action, DesktopFollowAction};

    const DESKTOP_POLL_INTERVAL: Duration = Duration::from_millis(350);

    struct ComApartment;

    impl Drop for ComApartment {
        fn drop(&mut self) {
            // SAFETY: 该守卫只在成功初始化 COM 的同一线程内创建和销毁。
            unsafe { CoUninitialize() };
        }
    }

    pub(super) fn configure(hwnd_value: isize) -> std::result::Result<(), String> {
        keep_topmost(hwnd_value).map_err(|error| error.to_string())?;
        thread::Builder::new()
            .name("desktop-pet-virtual-desktop".to_string())
            .spawn(move || {
                if let Err(error) = follow_active_desktop(hwnd_value) {
                    eprintln!("failed to follow Windows virtual desktop: {error}");
                }
            })
            .map(|_| ())
            .map_err(|error| error.to_string())
    }

    fn follow_active_desktop(hwnd_value: isize) -> Result<()> {
        // SAFETY: 后台线程独占此 COM apartment，所有接口都在该线程创建和释放。
        unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) }.ok()?;
        let _apartment = ComApartment;
        // SAFETY: Windows 10+ 提供进程内 VirtualDesktopManager COM 服务。
        let manager: IVirtualDesktopManager =
            unsafe { CoCreateInstance(&VirtualDesktopManager, None, CLSCTX_INPROC_SERVER) }?;
        let hwnd = HWND(hwnd_value as *mut c_void);

        loop {
            thread::sleep(DESKTOP_POLL_INTERVAL);
            // SAFETY: HWND 仅作为系统分配的非拥有句柄查询，销毁后由 IsWindow 终止线程。
            let window_is_valid = unsafe { IsWindow(Some(hwnd)).as_bool() };
            let window_is_on_current_desktop = window_is_valid
                && unsafe { manager.IsWindowOnCurrentVirtualDesktop(hwnd) }
                    .map(|value| value.as_bool())
                    .unwrap_or(true);
            let target_desktop = if window_is_valid && !window_is_on_current_desktop {
                // SAFETY: GetForegroundWindow 返回借用句柄；COM 仅读取其虚拟桌面标识。
                let foreground = unsafe { GetForegroundWindow() };
                (!foreground.0.is_null() && foreground != hwnd)
                    .then(|| unsafe { manager.GetWindowDesktopId(foreground).ok() })
                    .flatten()
            } else {
                None
            };

            match desktop_follow_action(
                window_is_valid,
                window_is_on_current_desktop,
                target_desktop.is_some(),
            ) {
                DesktopFollowAction::Move => {
                    let desktop_id = target_desktop.expect("move requires a desktop id");
                    // SAFETY: 桌宠 HWND 属于当前进程，desktop_id 来自当前前台顶层窗口。
                    if unsafe { manager.MoveWindowToDesktop(hwnd, &desktop_id) }.is_ok() {
                        let _ = keep_topmost(hwnd_value);
                    }
                }
                DesktopFollowAction::Stop => return Ok(()),
                DesktopFollowAction::Wait => {}
            }
        }
    }

    fn keep_topmost(hwnd_value: isize) -> Result<()> {
        let hwnd = HWND(hwnd_value as *mut c_void);
        // SAFETY: 不改变窗口尺寸、位置或激活状态，只恢复 topmost Z-order。
        unsafe {
            SetWindowPos(
                hwnd,
                Some(HWND_TOPMOST),
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
            )
        }
    }
}

#[cfg(target_os = "windows")]
pub fn configure_windows_desktop_pet(hwnd: isize) -> Result<(), String> {
    windows_overlay::configure(hwnd)
}

#[cfg(target_os = "linux")]
pub fn prepare_linux_window_backend() {
    let session_type = std::env::var("XDG_SESSION_TYPE").ok();
    let preference = linux_backend_preference(
        session_type.as_deref(),
        std::env::var_os("WAYLAND_DISPLAY").is_some(),
    );
    if let Some(backends) = preference {
        // 桌宠依赖全局坐标；优先 XWayland，并在 X11 不可用时回退原生 Wayland，保证应用仍可启动。
        std::env::set_var("GDK_BACKEND", backends);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefers_x11_with_wayland_fallback_for_wayland_sessions() {
        assert_eq!(
            linux_backend_preference(Some("wayland"), false),
            Some("x11,wayland")
        );
        assert_eq!(linux_backend_preference(None, true), Some("x11,wayland"));
        assert_eq!(linux_backend_preference(Some("x11"), false), None);
    }

    #[test]
    fn follows_windows_virtual_desktop_without_busy_work() {
        assert_eq!(
            desktop_follow_action(false, false, false),
            DesktopFollowAction::Stop
        );
        assert_eq!(
            desktop_follow_action(true, true, true),
            DesktopFollowAction::Wait
        );
        assert_eq!(
            desktop_follow_action(true, false, false),
            DesktopFollowAction::Wait
        );
        assert_eq!(
            desktop_follow_action(true, false, true),
            DesktopFollowAction::Move
        );
    }
}
