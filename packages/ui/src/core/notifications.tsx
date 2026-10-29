import { Toast } from "@base-ui/react/toast";

type ToastType = "success" | "error" | "warning" | "info";
type ToastOptions = Readonly<{
  id?: string;
  description?: string;
  duration?: number;
  action?: Readonly<{ label: string; onClick: () => void }>;
}>;

/** 全局只创建一个官方 manager；通知状态、计时和清理由 Base UI Provider 管理。 */
const toastManager = Toast.createToastManager();

function notify(type: ToastType, title: string, options: ToastOptions = {}) {
  const id = toastManager.add({
    id: options.id,
    title,
    type,
    description: options.description,
    timeout: options.duration ?? (type === "success" ? 2000 : 5000),
    // 操作后先关闭原通知，重试产生的新状态继续使用原生 manager 的同 ID 更新能力。
    actionProps: options.action
      ? {
          children: options.action.label,
          onClick() {
            toastManager.close(id);
            options.action?.onClick();
          },
        }
      : undefined,
  });
  return id;
}

/** 暴露官方 add/update/close/promise，同时复用现有业务调用，避免双端重复适配。 */
export const toast = Object.assign(toastManager, {
  success: (title: string, options?: ToastOptions) => notify("success", title, options),
  error: (title: string, options?: ToastOptions) => notify("error", title, options),
  warning: (title: string, options?: ToastOptions) => notify("warning", title, options),
  info: (title: string, options?: ToastOptions) => notify("info", title, options),
  dismiss: toastManager.close,
});
