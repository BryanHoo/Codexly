//! 使用 WinRT 事件订阅管理通知，不睡眠、不轮询，句柄回收时撤销事件并移除通知。
use std::sync::Arc;
use windows::{
    Data::Xml::Dom::XmlDocument,
    Foundation::TypedEventHandler,
    UI::Notifications::{
        ToastDismissalReason, ToastDismissedEventArgs, ToastNotification, ToastNotificationManager,
        ToastNotifier,
    },
    core::{HSTRING, Result},
};

pub struct TaskNotificationHandle {
    toast: ToastNotification,
    notifier: ToastNotifier,
    app_id: HSTRING,
    tag: HSTRING,
    activated: i64,
    dismissed: i64,
    failed: i64,
}

fn xml_text(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

impl TaskNotificationHandle {
    pub fn show(
        app_id: &str,
        tag: &str,
        title: &str,
        body: &str,
        response: impl Fn(bool) + Send + Sync + 'static,
    ) -> Result<Self> {
        let xml = XmlDocument::new()?;
        xml.LoadXml(&HSTRING::from(format!(
            "<toast><visual><binding template=\"ToastGeneric\"><text>{}</text><text>{}</text></binding></visual></toast>",
            xml_text(title), xml_text(body),
        )))?;
        let toast = ToastNotification::CreateToastNotification(&xml)?;
        let tag = HSTRING::from(tag);
        toast.SetTag(&tag)?;
        toast.SetGroup(&HSTRING::from("codexly-tasks"))?;
        let app_id = HSTRING::from(app_id);
        let notifier = ToastNotificationManager::CreateToastNotifierWithId(&app_id)?;
        let response = Arc::new(response);
        let clicked = response.clone();
        let activated = toast.Activated(&TypedEventHandler::new(move |_, _| {
            clicked(true);
            Ok(())
        }))?;
        let closed = response.clone();
        let dismissed = match toast.Dismissed(&TypedEventHandler::new(
            move |_, args: windows::core::Ref<'_, ToastDismissedEventArgs>| {
                // 横幅超时后仍可从通知中心点击；只有真正移除时才释放激活订阅。
                if args.as_ref().is_some_and(|args| {
                    args.Reason()
                        .is_ok_and(|reason| reason != ToastDismissalReason::TimedOut)
                }) {
                    closed(false);
                }
                Ok(())
            },
        )) {
            Ok(token) => token,
            Err(error) => {
                let _ = toast.RemoveActivated(activated);
                return Err(error);
            }
        };
        let failed = match toast.Failed(&TypedEventHandler::new(move |_, _| {
            response(false);
            Ok(())
        })) {
            Ok(token) => token,
            Err(error) => {
                let _ = toast.RemoveActivated(activated);
                let _ = toast.RemoveDismissed(dismissed);
                return Err(error);
            }
        };
        let handle = Self {
            toast,
            notifier,
            app_id,
            tag,
            activated,
            dismissed,
            failed,
        };
        handle.notifier.Show(&handle.toast)?;
        Ok(handle)
    }
}

impl Drop for TaskNotificationHandle {
    fn drop(&mut self) {
        // 先撤销回调再隐藏，避免主动回收被误识别为用户操作；只移除本条标签。
        let _ = self.toast.RemoveActivated(self.activated);
        let _ = self.toast.RemoveDismissed(self.dismissed);
        let _ = self.toast.RemoveFailed(self.failed);
        let _ = self.notifier.Hide(&self.toast);
        if let Ok(history) = ToastNotificationManager::History() {
            let _ = history.RemoveGroupedTagWithId(
                &self.tag,
                &HSTRING::from("codexly-tasks"),
                &self.app_id,
            );
        }
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn notification_content_is_encoded_as_xml_text() {
        assert_eq!(super::xml_text("A < B & C > D"), "A &lt; B &amp; C &gt; D");
    }
}
