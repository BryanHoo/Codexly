import { Toast } from "@base-ui/react/toast";
import {
  CircleCheck,
  Info,
  Loader2,
  OctagonX,
  TriangleAlert,
  X,
  type LucideIcon,
} from "lucide-react";
import { Button } from "./button.js";
import { toast } from "./notifications.js";

const icons: Partial<Record<string, LucideIcon>> = {
  success: CircleCheck,
  error: OctagonX,
  warning: TriangleAlert,
  info: Info,
  loading: Loader2,
};

/** 与 shadcn Base UI 示例一致：Provider 管理生命周期，Portal 避开工作台裁剪和层叠上下文。 */
export function Toaster({
  containerAriaLabel = "通知",
  closeButtonAriaLabel = "关闭通知",
  children,
  ...props
}: Toast.Provider.Props & {
  containerAriaLabel?: string;
  closeButtonAriaLabel?: string;
}) {
  return (
    <Toast.Provider toastManager={toast} limit={3} {...props}>
      {children}
      <Toast.Portal data-slot="toast-portal">
        <Toast.Viewport data-slot="toast-viewport" aria-label={containerAriaLabel}>
          <ToastList closeLabel={closeButtonAriaLabel} />
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  );
}

function ToastList({ closeLabel }: Readonly<{ closeLabel: string }>) {
  // 只有通知列表订阅 manager；提示变化不会触发两端应用树重新渲染。
  const { toasts } = Toast.useToastManager();
  return toasts.map((item) => {
    const Icon = item.type ? icons[item.type] : undefined;
    return (
      <Toast.Root
        key={item.id}
        toast={item}
        data-slot="toast"
        data-toast=""
        data-floating-surface=""
      >
        <Toast.Content data-slot="toast-content">
          {Icon ? <Icon data-slot="toast-icon" aria-hidden="true" /> : null}
          {/* 长正文保留原生触摸滚动；卡片边缘和状态图标仍可滑动关闭。 */}
          <div data-slot="toast-text" data-base-ui-swipe-ignore="">
            <Toast.Title data-slot="toast-title" />
            <Toast.Description data-slot="toast-description" />
          </div>
          <Toast.Action data-slot="toast-action" render={<Button variant="outline" size="sm" />} />
          <Toast.Close
            data-slot="toast-close"
            aria-label={closeLabel}
            render={<Button variant="ghost" size="icon-sm" />}
          >
            <X aria-hidden="true" />
          </Toast.Close>
        </Toast.Content>
      </Toast.Root>
    );
  });
}

export { toast };
