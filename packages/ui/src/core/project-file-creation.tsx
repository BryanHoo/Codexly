import {
  isValidProjectFileCreationName,
  type CreateProjectFileRequest,
  type CreateProjectFileResponse,
} from "@codexly/protocol";
import { useId, useRef, useState, type RefObject } from "react";
import { v4 as createUuid } from "uuid";

import { Button } from "./button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./dialog.js";
import { Input } from "./input.js";

export type ProjectFileCreationLabels = Readonly<{
  file: string;
  directory: string;
  description: string;
  name: string;
  create: string;
  cancel: string;
  close: string;
  invalidName: string;
  conflict: string;
  failed: string;
}>;
type CreationOptions = Readonly<{
  create: (
    input: CreateProjectFileRequest,
    options: { idempotencyKey: string },
  ) => Promise<CreateProjectFileResponse>;
  parentPath: string | null;
  labels: ProjectFileCreationLabels;
  onCreated: (result: CreateProjectFileResponse) => void;
  returnFocus: RefObject<HTMLElement | null>;
}>;

// 两端只注入传输和翻译，输入校验、提交互斥、错误恢复与焦点使用同一套交互。
export function useProjectFileCreation(options: CreationOptions) {
  const [type, setType] = useState<"file" | "directory" | null>(null);
  return {
    openCreateFile: () => {
      setType("file");
    },
    openCreateDirectory: () => {
      setType("directory");
    },
    dialog:
      type === null ? null : (
        <ProjectFileCreationDialog
          {...options}
          type={type}
          onClose={() => {
            setType(null);
          }}
        />
      ),
  };
}

function ProjectFileCreationDialog({
  create,
  labels,
  onCreated,
  onClose,
  parentPath,
  returnFocus,
  type,
}: CreationOptions & Readonly<{ type: "file" | "directory"; onClose: () => void }>) {
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lock = useRef(false);
  const attempt = useRef<{ name: string; key: string } | null>(null);
  const errorId = useId();
  const normalizedName = name.trim();
  const valid = isValidProjectFileCreationName(normalizedName);
  const validationMessage = name.length > 0 && !valid ? labels.invalidName : null;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !lock.current) onClose();
      }}
    >
      <DialogContent
        className="max-w-96 p-4"
        closeLabel={labels.close}
        closeDisabled={pending}
        initialFocus={inputRef}
        finalFocus={returnFocus}
      >
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!valid || lock.current) return;
            lock.current = true;
            setPending(true);
            setError(null);
            // 明确失败后的重试可重新提交；网络结果不明时复用同一输入的幂等键。
            if (attempt.current?.name !== normalizedName)
              attempt.current = { name: normalizedName, key: createUuid() };
            void create(
              { parentPath, name: normalizedName, type },
              { idempotencyKey: attempt.current.key },
            )
              .then(
                (result) => {
                  onCreated(result);
                  onClose();
                },
                (cause: unknown) => {
                  const code =
                    cause !== null && typeof cause === "object" && "code" in cause
                      ? cause.code
                      : null;
                  if (code !== null) attempt.current = null;
                  setError(code === "PROJECT_FILE_CONFLICT" ? labels.conflict : labels.failed);
                },
              )
              .finally(() => {
                lock.current = false;
                setPending(false);
              });
          }}
        >
          <DialogHeader>
            <DialogTitle>{labels[type]}</DialogTitle>
            <DialogDescription>{labels.description}</DialogDescription>
          </DialogHeader>
          <Input
            aria-label={labels.name}
            aria-invalid={validationMessage !== null}
            aria-describedby={validationMessage !== null || error !== null ? errorId : undefined}
            disabled={pending}
            maxLength={255}
            ref={inputRef}
            value={name}
            onChange={(event) => {
              setName(event.currentTarget.value);
              setError(null);
            }}
          />
          {validationMessage !== null || error !== null ? (
            <p className="text-label text-danger" id={errorId} role="alert">
              {validationMessage ?? error}
            </p>
          ) : null}
          <DialogFooter>
            <Button disabled={pending} onClick={onClose} size="sm" type="button" variant="outline">
              {labels.cancel}
            </Button>
            <Button disabled={pending || !valid} size="sm" type="submit">
              {labels.create}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
