import type { TextFileEditorLabels } from "@codexly/frontend-core/text-file-editor";
import { useEffect, useState } from "react";
import { Button } from "./button.js";

export type TextEditorNoticeKind =
  "capacity" | "load-error" | "unsupported" | "input-limit" | "error" | "conflict" | "plain-text";
export type TextEditorNoticeProps = Readonly<{
  kind: TextEditorNoticeKind | null;
  labels: TextFileEditorLabels;
  onRetryEdit: () => void;
  onRetrySave: () => void;
  onDismiss: () => void;
  onDiscard?: () => void;
  busy?: boolean;
}>;
export function TextEditorNotice({
  kind,
  labels,
  onRetryEdit,
  onRetrySave,
  onDismiss,
  onDiscard,
  busy = false,
}: TextEditorNoticeProps) {
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  useEffect(() => {
    setConfirmDiscard(false);
  }, [kind]);
  if (kind === null) return null;
  const messages = {
    capacity: labels.capacity,
    "load-error": labels.loadError,
    unsupported: labels.unsupported,
    "input-limit": labels.inputLimit,
    error: labels.saveError,
    conflict: labels.conflict,
    "plain-text": labels.plainText,
  };
  const saveFailed = kind === "error" || kind === "conflict";
  const canRetryEdit = kind === "capacity" || kind === "load-error";
  // 提示留在正文上方，原因和恢复动作始终可见；窄屏换行，不覆盖编辑区或抢占焦点。
  return (
    <div
      className="flex shrink-0 flex-wrap items-center gap-2 border-b border-separator bg-raised px-3 py-2 text-body-small"
      role={saveFailed || kind === "input-limit" ? "alert" : "status"}
      data-text-editor-notice={kind}
    >
      <p className="min-w-0 flex-1 basis-48 whitespace-normal [overflow-wrap:anywhere]">
        {confirmDiscard && saveFailed ? labels.discardConfirm : messages[kind]}
      </p>
      {saveFailed && onDiscard ? (
        confirmDiscard ? (
          <>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => {
                // 二次确认才丢弃当前文件草稿；保存中禁止执行，防止回执与放弃动作交叉。
                onDiscard();
                setConfirmDiscard(false);
              }}
            >
              {labels.confirmDiscard}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setConfirmDiscard(false);
              }}
            >
              {labels.keepEditing}
            </Button>
          </>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setConfirmDiscard(true);
            }}
          >
            {labels.discard}
          </Button>
        )
      ) : null}
      {canRetryEdit || (saveFailed && !confirmDiscard) ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={canRetryEdit ? onRetryEdit : onRetrySave}
        >
          {busy ? labels.retrying : canRetryEdit ? labels.retryEdit : labels.retrySave}
        </Button>
      ) : kind === "input-limit" ? (
        <Button type="button" size="sm" variant="ghost" onClick={onDismiss}>
          {labels.dismiss}
        </Button>
      ) : null}
    </div>
  );
}
