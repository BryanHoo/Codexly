import { isValidProjectFileCreationName } from "@codexly/protocol";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "./button.js";
import { Input } from "./input.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./dialog.js";

export type ProjectFileMutationProps = Readonly<{
  isPending: boolean;
  onClose: () => void;
  targetType: "directory" | "file";
  error?: unknown;
}>;
export type ProjectFileRenameProps = ProjectFileMutationProps &
  Readonly<{ initialName: string; onRename: (name: string) => void }>;
export type ProjectFileDeleteProps = ProjectFileMutationProps &
  Readonly<{ name: string; onDelete: () => void }>;
type Labels = Readonly<{
  title: string;
  description: string;
  name: string;
  submit: string;
  cancel: string;
  close: string;
  invalidName: string;
  failed: string;
  conflict: string;
}>;

function errorMessage(error: unknown, labels: Labels) {
  if (!error) return null;
  const code = typeof error === "object" && "code" in error ? error.code : null;
  return code === "PROJECT_FILE_CONFLICT" || code === "EEXIST" ? labels.conflict : labels.failed;
}

export function ProjectFileMutationDialog({
  isPending,
  onClose,
  targetType,
  error,
  labels,
  ...action
}: ProjectFileMutationProps &
  Readonly<{ labels: Labels }> &
  (
    | { initialName: string; onRename: (name: string) => void }
    | { name: string; onDelete: () => void }
  )) {
  const rename = "onRename" in action;
  const initialName = rename ? action.initialName : action.name;
  const [name, setName] = useState(initialName);
  const [dismissError, setDismissError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const errorId = useId();
  const normalized = name.trim();
  const valid = isValidProjectFileCreationName(normalized);
  const invalid = rename && !valid;
  const message = invalid ? labels.invalidName : dismissError ? null : errorMessage(error, labels);
  useEffect(() => {
    setDismissError(false);
  }, [error, isPending]);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !isPending) onClose();
      }}
    >
      <DialogContent
        closeLabel={labels.close}
        closeDisabled={isPending}
        className="max-w-96 p-4"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          if (!rename) {
            cancelRef.current?.focus();
            return;
          }
          const input = inputRef.current;
          if (!input) return;
          input.focus();
          // 保留扩展名便于连续重命名；点文件和目录选择全名，避免误把目录后缀当成扩展名。
          const dot = initialName.lastIndexOf(".");
          input.setSelectionRange(0, targetType === "file" && dot > 0 ? dot : initialName.length);
        }}
      >
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (isPending) return;
            if (rename) {
              if (valid && normalized !== initialName) action.onRename(normalized);
            } else action.onDelete();
          }}
        >
          <DialogHeader>
            <DialogTitle>{labels.title}</DialogTitle>
            <DialogDescription>{labels.description}</DialogDescription>
          </DialogHeader>
          {rename ? (
            <Input
              ref={inputRef}
              aria-label={labels.name}
              aria-invalid={invalid}
              aria-describedby={message ? errorId : undefined}
              disabled={isPending}
              maxLength={255}
              value={name}
              onChange={(event) => {
                setName(event.currentTarget.value);
                setDismissError(true);
              }}
            />
          ) : null}
          {message ? (
            <p role="alert" id={errorId} className="text-label text-danger">
              {message}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              ref={cancelRef}
              disabled={isPending}
              onClick={onClose}
              type="button"
              variant="outline"
            >
              {labels.cancel}
            </Button>
            <Button
              disabled={isPending || (rename && (!valid || normalized === initialName))}
              type="submit"
              variant={rename ? "default" : "destructive"}
            >
              {labels.submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
