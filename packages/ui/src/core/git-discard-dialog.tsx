import type { DiscardProjectChangesRequest } from "@codexly/frontend-core/git-workspace-contract";
import { useRef, useState } from "react";
import { Button } from "./button.js";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./dialog.js";

/** 确认内容固定为打开时的选择，外部刷新只影响快照校验。 */
export default function GitDiscardDialog({
  request,
  snapshot,
  busy,
  language,
  onCancel,
  onConfirm,
}: Readonly<{
  request: DiscardProjectChangesRequest;
  snapshot: string;
  busy: boolean;
  language: string;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}>) {
  const [discarding, setDiscarding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const stale = request.expectedSnapshot !== snapshot;
  const copy = language.startsWith("zh")
    ? {
        title: "丢弃所选文件的变更？",
        description: "将恢复所选文件的暂存及未暂存变更，并删除所选新增文件。此操作无法撤销。",
        confirm: "确认丢弃",
        cancel: "取消",
        pending: "正在丢弃…",
        stale: "变更已更新，请取消后重新选择并确认。",
      }
    : {
        title: "Discard changes to selected files?",
        description:
          "Restore staged and unstaged changes and delete selected new files. This cannot be undone.",
        confirm: "Confirm discard",
        cancel: "Cancel",
        pending: "Discarding…",
        stale: "Changes have updated. Cancel and review the selection again.",
      };
  const confirm = async () => {
    if (pending.current || busy || stale) return;
    pending.current = true;
    setDiscarding(true);
    setError(null);
    try {
      await onConfirm();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      pending.current = false;
      setDiscarding(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !discarding) onCancel();
      }}
    >
      <DialogContent closeDisabled={discarding}>
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        <ul className="max-h-48 overflow-y-auto break-all font-mono text-caption">
          {request.paths.map((path) => (
            <li key={path}>{path}</li>
          ))}
        </ul>
        {error ? (
          <p role="alert" className="text-caption text-danger">
            {error}
          </p>
        ) : null}
        {stale ? (
          <p role="alert" className="text-caption text-danger">
            {copy.stale}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" disabled={discarding} onClick={onCancel}>
            {copy.cancel}
          </Button>
          <Button
            variant="destructive"
            disabled={busy || discarding || stale}
            onClick={() => {
              void confirm();
            }}
          >
            {discarding ? copy.pending : copy.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
