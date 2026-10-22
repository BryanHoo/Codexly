import { createToastStore, type ToastOptions } from "@codexly/frontend-core/toast-store";

/** 所有宿主和共享表单只通过此入口发送通知，避免各自创建浮层或计时器。 */
export const notificationStore = createToastStore();
export const toast = {
  success: (message: string, options?: ToastOptions) =>
    notificationStore.show("success", message, options),
  error: (message: string, options?: ToastOptions) =>
    notificationStore.show("error", message, options),
  warning: (message: string, options?: ToastOptions) =>
    notificationStore.show("warning", message, options),
  info: (message: string, options?: ToastOptions) =>
    notificationStore.show("info", message, options),
  dismiss: notificationStore.dismiss,
};
