//! macOS 系统通知适配：单个 delegate 处理所有点击，完全不查询或轮询已投递通知。
use std::cell::RefCell;
use std::sync::Arc;

use block2::{Block, RcBlock};
use objc2::{
    AnyThread, DefinedClass, class, define_class, extern_protocol, msg_send, rc::Retained,
    runtime::AnyObject,
};
use objc2_foundation::{NSArray, NSBundle, NSError, NSObject, NSObjectProtocol, NSSet, NSString};

// 两档应用最低为 macOS 12.4，UserNotifications 从 macOS 10.14 起即可用。
#[link(name = "UserNotifications", kind = "framework")]
unsafe extern "C" {}

extern_protocol!(
    #[name = "UNUserNotificationCenterDelegate"]
    unsafe trait NotificationDelegate: NSObjectProtocol {
        #[optional]
        #[unsafe(method(userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:))]
        unsafe fn received(
            &self,
            center: &AnyObject,
            response: &AnyObject,
            completed: &Block<dyn Fn()>,
        );

        #[optional]
        #[unsafe(method(userNotificationCenter:willPresentNotification:withCompletionHandler:))]
        unsafe fn present(
            &self,
            center: &AnyObject,
            notification: &AnyObject,
            completed: &Block<dyn Fn(usize)>,
        );
    }
);

struct DelegateState {
    clicked: Box<dyn Fn(String, bool) + Send + Sync>,
}

define_class!(
    #[unsafe(super = NSObject)]
    #[name = "CodexlyTaskNotificationDelegate"]
    #[ivars = DelegateState]
    struct Delegate;
    unsafe impl NSObjectProtocol for Delegate {}
    unsafe impl NotificationDelegate for Delegate {
        #[unsafe(method(userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:))]
        unsafe fn received(
            &self,
            center: &AnyObject,
            response: &AnyObject,
            completed: &Block<dyn Fn()>,
        ) {
            // SAFETY: 签名来自 UNUserNotificationCenterDelegate；所有借用只在系统回调内使用。
            let (action, identifier): (Retained<NSString>, Retained<NSString>) = unsafe {
                let action = msg_send![response, actionIdentifier];
                let notification: Retained<AnyObject> = msg_send![response, notification];
                let request: Retained<AnyObject> = msg_send![&notification, request];
                (action, msg_send![&request, identifier])
            };
            remove(center, &identifier);
            // 必须先完成系统回调，再执行应用导航，避免窗口操作延迟通知服务。
            completed.call(());
            if let Some((_, route)) = identifier.to_string().split_once(':') {
                (self.ivars().clicked)(
                    route.to_owned(),
                    action.to_string() == "com.apple.UNNotificationDefaultActionIdentifier",
                );
            }
        }

        #[unsafe(method(userNotificationCenter:willPresentNotification:withCompletionHandler:))]
        unsafe fn present(
            &self,
            center: &AnyObject,
            notification: &AnyObject,
            completed: &Block<dyn Fn(usize)>,
        ) {
            // 完成回调可能释放系统参数，先持有 identifier，再结束前台展示并释放观察资源。
            let identifier: Retained<NSString> = unsafe {
                let request: Retained<AnyObject> = msg_send![notification, request];
                msg_send![&request, identifier]
            };
            // 前台通知交给应用内活动提示，不重复弹系统横幅。
            completed.call((0,));
            remove(center, &identifier);
            if let Some((_, route)) = identifier.to_string().split_once(':') {
                (self.ivars().clicked)(route.to_owned(), false);
            }
        }
    }
);

thread_local! {
    // 系统 delegate 为弱引用，应用主线程持有唯一强引用直到退出。
    static DELEGATE: RefCell<Option<Retained<Delegate>>> = const { RefCell::new(None) };
}

fn center() -> Result<Retained<AnyObject>, &'static str> {
    // 开发模式未打包时缺少 bundle identity，直接降级为应用内通知，避免系统抛出异常。
    if NSBundle::mainBundle().bundleIdentifier().is_none() {
        return Err("system notifications require an application bundle");
    }
    // SAFETY: framework 已链接，返回的是有效的 UNUserNotificationCenter 单例。
    Ok(unsafe { msg_send![class!(UNUserNotificationCenter), currentNotificationCenter] })
}

/// 在 Tauri setup 主线程安装 delegate，确保应用启动完成前即可接收点击。
pub fn initialize_notifications(
    clicked: impl Fn(String, bool) + Send + Sync + 'static,
) -> Result<(), &'static str> {
    let _main = objc2::MainThreadMarker::new()
        .ok_or("notification initialization requires the main thread")?;
    let center = center()?;
    DELEGATE.with(|slot| {
        if slot.borrow().is_some() {
            return;
        }
        let delegate = Delegate::alloc().set_ivars(DelegateState {
            clicked: Box::new(clicked),
        });
        // SAFETY: NSObject 初始化后 delegate 的强引用留存在主线程；系统只借用该对象。
        let delegate: Retained<Delegate> = unsafe { msg_send![super(delegate), init] };
        unsafe {
            let _: () = msg_send![&center, setDelegate: &*delegate];
            // customDismissAction 让用户清除通知时也收到 delegate 回调，及时释放对应观察资源。
            let empty = NSArray::<AnyObject>::new();
            let category: Retained<AnyObject> = msg_send![class!(UNNotificationCategory), categoryWithIdentifier: &*NSString::from_str("codexly-task"), actions: &*empty, intentIdentifiers: &*empty, options: 1usize];
            let categories = NSSet::from_slice(&[&*category]);
            let _: () = msg_send![&center, setNotificationCategories: &*categories];
        }
        *slot.borrow_mut() = Some(delegate);
    });
    Ok(())
}

/// 异步申请授权和投递，不运行嵌套事件循环，也不等待点击或投递确认。
pub fn show_notification(
    identifier: &str,
    title: &str,
    body: &str,
    active: impl Fn() -> bool + Send + Sync + 'static,
    failed: impl Fn(String) + Send + Sync + 'static,
) -> Result<(), &'static str> {
    objc2::rc::autoreleasepool(|_| {
        show_notification_in_pool(identifier, title, body, active, failed)
    })
}

fn show_notification_in_pool(
    identifier: &str,
    title: &str,
    body: &str,
    active: impl Fn() -> bool + Send + Sync + 'static,
    failed: impl Fn(String) + Send + Sync + 'static,
) -> Result<(), &'static str> {
    let delivery_center = center()?;
    let identifier = NSString::from_str(identifier);
    // SAFETY: 下列 selector 及所有权遵循 UserNotifications SDK；request 由授权回调强持有。
    let request: Retained<AnyObject> = unsafe {
        let content: Retained<AnyObject> = msg_send![class!(UNMutableNotificationContent), new];
        let _: () = msg_send![&content, setTitle: &*NSString::from_str(title)];
        let _: () = msg_send![&content, setBody: &*NSString::from_str(body)];
        let _: () =
            msg_send![&content, setCategoryIdentifier: &*NSString::from_str("codexly-task")];
        msg_send![class!(UNNotificationRequest), requestWithIdentifier: &*identifier, content: &*content, trigger: Option::<&AnyObject>::None]
    };
    let active = Arc::new(active);
    let delivered_active = active.clone();
    let delivered_id = identifier.to_string();
    let failed = Arc::new(failed);
    let delivery_failed = failed.clone();
    let delivered = RcBlock::new(move |error: *mut NSError| {
        if let Some(error) = unsafe { error.as_ref() } {
            delivery_failed(error.localizedDescription().to_string());
        }
        if !delivered_active() {
            close_notification(&delivered_id);
        }
    });
    let authorized = RcBlock::new(move |granted: objc2::runtime::Bool, error: *mut NSError| {
        if !active() {
            return;
        }
        if !granted.as_bool() {
            let message = unsafe { error.as_ref() }.map_or_else(
                || "notification permission is not granted".to_owned(),
                |error| error.localizedDescription().to_string(),
            );
            failed(message);
            return;
        }
        // SAFETY: 回调捕获强引用，调用线程由系统决定；UNUserNotificationCenter API 支持异步调用。
        unsafe {
            let _: () = msg_send![&delivery_center, addNotificationRequest: &*request, withCompletionHandler: &*delivered];
        }
    });
    // 只请求本应用实际使用的 alert 权限；已记录授权时不再次弹窗。
    let center = center()?;
    unsafe {
        let _: () = msg_send![&center, requestAuthorizationWithOptions: 4usize, completionHandler: &*authorized];
    }
    Ok(())
}

fn remove(center: &AnyObject, identifier: &NSString) {
    let identifiers = NSArray::from_slice(&[identifier]);
    // SAFETY: identifiers 中只有本应用的 request identity；两项调用都异步返回。
    unsafe {
        let _: () =
            msg_send![center, removePendingNotificationRequestsWithIdentifiers: &*identifiers];
        let _: () = msg_send![center, removeDeliveredNotificationsWithIdentifiers: &*identifiers];
    }
}

pub fn close_notification(identifier: &str) {
    objc2::rc::autoreleasepool(|_| close_notification_in_pool(identifier));
}

fn close_notification_in_pool(identifier: &str) {
    if let Ok(center) = center() {
        remove(&center, &NSString::from_str(identifier));
    }
}
