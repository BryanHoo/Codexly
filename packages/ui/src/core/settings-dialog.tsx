import type { ReactNode } from "react";
import { Dialog, DialogContent, DialogTitle } from "./dialog.js";

/** 设置与工作台共存；所有关闭入口交给保存屏障，保持焦点恢复与原生模态语义。 */
export function SettingsDialog({
  title,
  closeLabel,
  onClose,
  children,
}: Readonly<{
  title: string;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
}>) {
  return (
    <Dialog
      open
      onOpenChange={(open, details) => {
        if (!open) {
          details.cancel();
          onClose();
        }
      }}
    >
      <DialogContent
        closeLabel={closeLabel}
        className="h-[min(56rem,calc(100dvh-3rem))] w-[calc(100%-3rem)] max-w-[92rem] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden rounded-2xl p-0 max-sm:h-[calc(100dvh-1rem)] max-sm:w-[calc(100%-1rem)]"
      >
        <DialogTitle className="flex h-14 items-center border-b border-separator px-5 text-body">
          {title}
        </DialogTitle>
        {children}
      </DialogContent>
    </Dialog>
  );
}
