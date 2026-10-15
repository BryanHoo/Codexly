import { Download, LoaderCircle, X } from "lucide-react";
import { useId, useRef, useState, type ReactNode } from "react";

import { Button } from "./button.js";
import { Dialog, DialogContent, DialogTitle } from "./dialog.js";

type AppUpdateDialogLabels = Readonly<
  Record<"title" | "close" | "update" | "updating" | "completed" | "failed" | "progress", string>
>;

/** 两端共用日志弹窗和安装交互，平台只负责提供日志、安装接口与进度。 */
export function AppUpdateDialog({
  children,
  isPending = false,
  labels,
  onClose,
  onUpdate,
  percentage,
}: Readonly<{
  children: ReactNode;
  isPending?: boolean;
  labels: AppUpdateDialogLabels;
  onClose: () => void;
  onUpdate: (onProgress: (percentage: number | null) => void) => Promise<void>;
  percentage?: number;
}>) {
  const titleId = useId();
  const busy = useRef(false);
  const [status, setStatus] = useState<"idle" | "pending" | "completed" | "failed">("idle");
  const [reportedPercentage, setReportedPercentage] = useState<number | null>(null);
  const updating = isPending || status === "pending";
  const progress = percentage ?? reportedPercentage;
  const close = () => {
    // 安装期间保留进度窗口，避免重开弹窗丢失原生进度回调或重复提交。
    if (!busy.current && !isPending) onClose();
  };
  const update = async () => {
    // 同步锁覆盖 React 提交前的连续点击；失败释放锁后允许重试。
    if (busy.current || isPending || status === "completed") return;
    busy.current = true;
    setReportedPercentage(null);
    setStatus("pending");
    try {
      await onUpdate(setReportedPercentage);
      setStatus("completed");
    } catch {
      setStatus("failed");
    } finally {
      busy.current = false;
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        aria-labelledby={titleId}
        className="max-h-[min(80dvh,40rem)] max-w-2xl grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden p-0"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          document.getElementById("global-settings-about-trigger")?.focus();
        }}
      >
        <header className="flex items-center gap-3 px-5 pt-5">
          <DialogTitle className="min-w-0 flex-1" id={titleId}>
            {labels.title}
          </DialogTitle>
          <Button
            aria-label={labels.close}
            disabled={updating}
            onClick={close}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <X aria-hidden="true" className="size-4" />
          </Button>
        </header>
        <div className="min-h-0 overflow-y-auto border-t border-separator px-5 py-4">
          {children}
        </div>
        <footer className="flex flex-wrap items-center justify-end gap-3 border-t border-separator px-5 py-3">
          {status === "failed" ? (
            <p className="min-w-0 flex-1 text-body-small text-danger" role="alert">
              {labels.failed}
            </p>
          ) : null}
          {status === "completed" ? (
            <p className="min-w-0 flex-1 text-body-small text-muted-foreground" role="status">
              {labels.completed}
            </p>
          ) : null}
          {updating && progress !== null ? (
            <progress
              aria-label={labels.progress}
              className="h-1.5 min-w-20 flex-1"
              max={100}
              value={progress}
            />
          ) : null}
          <Button
            disabled={updating || status === "completed"}
            onClick={() => void update()}
            size="sm"
            type="button"
          >
            {updating ? (
              <LoaderCircle aria-hidden="true" className="animate-spin" data-icon="inline-start" />
            ) : (
              <Download aria-hidden="true" data-icon="inline-start" />
            )}
            {updating ? labels.updating : labels.update}
            {updating && progress !== null ? ` ${String(progress)}%` : null}
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
