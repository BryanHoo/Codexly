import { useId, useRef, useState } from "react";

import { Button } from "./button.js";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "./dialog.js";
import { Input } from "./input.js";

export type TaskRenameDialogProps = Readonly<{
  initialTitle: string;
  isPending: boolean;
  onClose: () => void;
  onRename: (title: string) => void;
}>;

export function TaskRenameDialog({
  initialTitle,
  isPending,
  onClose,
  onRename,
  labels,
}: TaskRenameDialogProps &
  Readonly<{
    labels: { title: string; name: string; cancel: string; save: string; close: string };
  }>) {
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const [title, setTitle] = useState(initialTitle);
  const normalized = title.trim();

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open && !isPending) {
          onClose();
        }
      }}
      open
    >
      <DialogContent
        closeLabel={labels.close}
        closeDisabled={isPending}
        aria-labelledby={titleId}
        className="max-w-96 p-4"
        onOpenAutoFocus={(event) => {
          const input = inputRef.current;
          if (!input) return;
          event.preventDefault();
          // 弹窗打开后选中完整标题，直接输入即可替换。
          input.focus();
          input.select();
        }}
      >
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (normalized && !isPending) onRename(normalized);
          }}
        >
          <DialogHeader>
            <DialogTitle id={titleId}>{labels.title}</DialogTitle>
          </DialogHeader>
          <Input
            aria-label={labels.name}
            ref={inputRef}
            disabled={isPending}
            maxLength={200}
            onChange={(event) => {
              setTitle(event.currentTarget.value);
            }}
            value={title}
          />
          <DialogFooter>
            <Button disabled={isPending} onClick={onClose} type="button" variant="ghost">
              {labels.cancel}
            </Button>
            <Button disabled={isPending || !normalized} type="submit">
              {labels.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
