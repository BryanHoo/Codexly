use std::{cell::RefCell, ptr::NonNull, rc::Rc};

use block2::RcBlock;
use objc2::{MainThreadMarker, Message, rc::Retained, runtime::ProtocolObject};
use objc2_app_kit::{
    NSView, NSWindow, NSWindowDidExitFullScreenNotification, NSWindowStyleMask,
    NSWindowWillCloseNotification,
};
use objc2_foundation::{NSNotification, NSNotificationCenter, NSObjectProtocol, NSOperationQueue};
use raw_window_handle::{HasWindowHandle, RawWindowHandle};

/// 隐藏窗口前退出全屏；等待 AppKit 完成动画后调用回调，避免窗口状态与 Tauri 脱节。
pub fn exit_fullscreen_before_hide(
    handle: &impl HasWindowHandle,
    completed: impl FnOnce() + 'static,
) -> Result<(), &'static str> {
    let _mtm = MainThreadMarker::new().ok_or("fullscreen exit requires the main thread")?;
    let handle = handle.window_handle().map_err(|_| "window handle unavailable")?;
    let RawWindowHandle::AppKit(handle) = handle.as_raw() else {
        return Err("expected an AppKit window handle");
    };
    // SAFETY: HasWindowHandle 的借用保证 NSView 有效；上方已验证当前线程为 AppKit 主线程。
    let view = unsafe { handle.ns_view.cast::<NSView>().as_ref() };
    let window = view.window().ok_or("native window unavailable")?;
    if !window.styleMask().contains(NSWindowStyleMask::FullScreen) {
        completed();
        return Ok(());
    }

    wait_for_fullscreen_exit(&window, completed);
    // 先注册通知再退出全屏，避免动画关闭或系统快速切换时漏掉完成信号。
    window.toggleFullScreen(None);
    Ok(())
}

fn wait_for_fullscreen_exit(window: &NSWindow, completed: impl FnOnce() + 'static) {
    let center = NSNotificationCenter::defaultCenter();
    let observer: Rc<RefCell<Option<Retained<ProtocolObject<dyn NSObjectProtocol>>>>> =
        Rc::new(RefCell::new(None));
    let callback_observer = observer.clone();
    let callback_center = center.clone();
    let window = window.retain();
    let callback_window = window.clone();
    let completion = RefCell::new(Some(completed));
    let callback = RcBlock::new(move |notification: NonNull<NSNotification>| {
        // SAFETY: AppKit 同步通知参数在回调期间有效；系统通知名为进程生命周期内的静态常量。
        let notification = unsafe { notification.as_ref() };
        let name = notification.name();
        let did_exit = &*name == unsafe { NSWindowDidExitFullScreenNotification };
        let will_close = &*name == unsafe { NSWindowWillCloseNotification };
        if !did_exit && !will_close {
            return;
        }
        let Some(completed) = completion.borrow_mut().take() else {
            return;
        };
        if let Some(observer) = callback_observer.borrow_mut().take() {
            // SAFETY: token 来自同一通知中心；移除并释放它，打破回调持有链。
            unsafe { callback_center.removeObserver((*observer).as_ref()) };
        }
        if will_close {
            completed();
            return;
        }

        // 等本轮通知和 Tao 的窗口样式恢复结束再通知 Tauri 隐藏，不使用固定延迟或状态轮询。
        let finish = RefCell::new(Some((callback_window.clone(), completed)));
        let operation = RcBlock::new(move || {
            if let Some((window, completed)) = finish.borrow_mut().take() {
                drop(window);
                completed();
            }
        });
        // SAFETY: 仅投递到主队列，捕获的 AppKit 对象和回调始终在主线程使用及释放。
        unsafe { NSOperationQueue::mainQueue().addOperationWithBlock(&operation) };
    });
    // SAFETY: 仅监听该 NSWindow；窗口通知由 AppKit 主线程发布，queue=None 同步处理。
    *observer.borrow_mut() = Some(unsafe {
        center.addObserverForName_object_queue_usingBlock(None, Some(&window), None, &callback)
    });
}
