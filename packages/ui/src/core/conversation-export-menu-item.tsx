import { Download, LoaderCircle } from "lucide-react";
import { useSyncExternalStore } from "react";
import { DropdownMenuItem } from "./dropdown-menu.js";
import { toast } from "./notifications.js";

const pendingTasks = new Set<string>();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const notify = () => {
  for (const listener of listeners) listener();
};

/** 任务菜单关闭重开或同一任务出现多个入口时，共享在途标记，避免重复读取和弹出保存窗口。 */
export function ConversationExportMenuItem({
  taskKey,
  disabled,
  onExport,
  labels,
  className,
}: Readonly<{
  taskKey: string;
  disabled: boolean;
  onExport?: (() => Promise<string | null>) | undefined;
  labels: {
    export: string;
    exporting: string;
    succeeded: string;
    failed: string;
    tooLarge: string;
  };
  className?: string;
}>) {
  const pending = useSyncExternalStore(
    subscribe,
    () => pendingTasks.has(taskKey),
    () => false,
  );
  return (
    <DropdownMenuItem
      className={className}
      disabled={disabled || pending || onExport === undefined}
      onSelect={(event) => {
        // 保持菜单可见，展示进度；互斥标记在 await 前设置，也覆盖连续键盘/指针触发。
        event.preventDefault();
        if (disabled || pendingTasks.has(taskKey) || onExport === undefined) return;
        pendingTasks.add(taskKey);
        notify();
        void (async () => {
          try {
            const fileName = await onExport();
            if (fileName !== null) toast.success(labels.succeeded);
          } catch (error) {
            toast.error(error instanceof RangeError ? labels.tooLarge : labels.failed);
          } finally {
            pendingTasks.delete(taskKey);
            notify();
          }
        })();
      }}
    >
      {pending ? (
        <LoaderCircle
          className="size-3.5 animate-spin motion-reduce:animate-none"
          aria-hidden="true"
        />
      ) : (
        <Download className="size-3.5" aria-hidden="true" />
      )}
      {pending ? labels.exporting : labels.export}
    </DropdownMenuItem>
  );
}
