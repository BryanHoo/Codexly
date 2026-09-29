import { FolderOpen, FolderPlus, LoaderCircle } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
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

export type NewProjectLabels = Readonly<
  Record<
    | "title"
    | "parent"
    | "name"
    | "path"
    | "choose"
    | "cancel"
    | "create"
    | "creating"
    | "invalidName"
    | "loadError"
    | "createError"
    | "addError"
    | "existsDirectory"
    | "existsFile"
    | "addExisting"
    | "retryAdd"
    | "retry"
    | "loading",
    string
  >
>;

export interface NewProjectClient {
  listProjectDirectories: (
    path?: string,
    options?: { signal?: AbortSignal },
  ) => Promise<{ path: string }>;
  createProjectDirectory: (
    request: { parentPath: string; name: string },
    options?: { idempotencyKey?: string },
  ) => Promise<{
    path: string;
    status: "created" | "exists-directory" | "exists-file";
  }>;
}

interface NewProjectDialogProps {
  createRequestId: () => string;
  client: NewProjectClient;
  labels: NewProjectLabels;
  hostLabel: string;
  storageKey: string;
  validateName: (name: string) => boolean;
  onAdd: (paths: readonly string[]) => Promise<boolean>;
  onClose: () => void;
  renderDirectoryPicker: (props: {
    initialPath: string;
    onSelect: (path: string) => void;
    onCancel: () => void;
  }) => ReactNode;
}

export function NewProjectDialog({
  createRequestId,
  client,
  labels,
  hostLabel,
  storageKey,
  validateName,
  onAdd,
  onClose,
  renderDirectoryPicker,
}: NewProjectDialogProps) {
  const id = useId();
  const [parent, setParent] = useState("");
  const [name, setName] = useState("");
  const [choosing, setChoosing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<keyof NewProjectLabels>();
  const [target, setTarget] = useState<{ path: string; created: boolean }>();
  const lock = useRef(false);
  const request = useRef<{ parentPath: string; name: string; key: string } | undefined>(undefined);
  const valid = validateName(name);
  const separator = parent.startsWith("/") ? "/" : "\\";
  const path = parent ? `${parent.replace(/[\\/]+$/u, "")}${separator}${name}` : "";

  useEffect(() => {
    const controller = new AbortController();
    let saved: string | undefined;
    try {
      saved = localStorage.getItem(storageKey) ?? undefined;
    } catch {
      /* 存储受限时使用主目录。 */
    }
    setLoading(true);
    setError(undefined);
    const load = async () => {
      try {
        let listing;
        try {
          listing = await client.listProjectDirectories(saved, { signal: controller.signal });
        } catch (failure) {
          if (!saved || controller.signal.aborted) throw failure;
          listing = await client.listProjectDirectories(undefined, { signal: controller.signal });
        }
        if (!controller.signal.aborted) setParent(listing.path);
      } catch {
        if (!controller.signal.aborted) setError("loadError");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => {
      controller.abort();
    };
  }, [client, storageKey, loadAttempt]);

  const submit = async () => {
    if (lock.current || !parent || !valid || loading) return;
    lock.current = true;
    setBusy(true);
    setError(undefined);
    let adding = false;
    try {
      let selected = target;
      if (!selected) {
        // 网络失败后沿用同一幂等键，避免把刚创建成功的目录误判为原有目录。
        if (request.current?.parentPath !== parent || request.current.name !== name) {
          request.current = { parentPath: parent, name, key: createRequestId() };
        }
        const result = await client.createProjectDirectory(
          { parentPath: parent, name },
          { idempotencyKey: request.current.key },
        );
        if (result.status === "exists-file") {
          setError("existsFile");
          return;
        }
        selected = { path: result.path, created: result.status === "created" };
        setTarget(selected);
        if (!selected.created) {
          setError("existsDirectory");
          return;
        }
        try {
          localStorage.setItem(storageKey, parent);
        } catch {
          /* 保存偏好失败不影响创建。 */
        }
      }
      // 保留已创建的目标；注册失败后仅重试添加，不再重复创建或删除目录。
      adding = true;
      if (!(await onAdd([selected.path]))) setError("addError");
      else onClose();
    } catch {
      setError(adding ? "addError" : "createError");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };

  if (choosing)
    return renderDirectoryPicker({
      initialPath: parent,
      onCancel: () => {
        setChoosing(false);
      },
      onSelect: (value) => {
        setParent(value);
        setTarget(undefined);
        setError(undefined);
        setChoosing(false);
      },
    });

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        className="max-w-lg gap-5"
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>{labels.title}</DialogTitle>
          <DialogDescription className="break-words [overflow-wrap:anywhere]">
            {hostLabel}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex min-w-0 flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="flex min-w-0 flex-col gap-2">
            <span className="text-body-small font-medium" id={`${id}-parent`}>
              {labels.parent}
            </span>
            <div className="flex min-w-0 items-center gap-2">
              <p
                aria-labelledby={`${id}-parent`}
                className="min-w-0 flex-1 break-words font-mono text-body-small [overflow-wrap:anywhere]"
              >
                {loading ? labels.loading : parent || "—"}
              </p>
              <Button
                className="h-11 shrink-0 sm:h-9"
                disabled={busy || loading || target?.created}
                onClick={() => {
                  setChoosing(true);
                }}
                type="button"
                variant="outline"
              >
                <FolderOpen aria-hidden="true" />
                {labels.choose}
              </Button>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-body-small font-medium" htmlFor={`${id}-name`}>
              {labels.name}
            </label>
            <Input
              autoFocus
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              id={`${id}-name`}
              className="h-11 text-base sm:h-9"
              disabled={busy || target?.created}
              value={name}
              maxLength={255}
              aria-invalid={name.length > 0 && !valid}
              aria-describedby={name.length > 0 && !valid ? `${id}-invalid` : undefined}
              onChange={(event) => {
                setName(event.target.value);
                setTarget(undefined);
                setError(undefined);
              }}
            />
            {name.length > 0 && !valid ? (
              <p id={`${id}-invalid`} className="text-caption text-danger">
                {labels.invalidName}
              </p>
            ) : null}
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-caption text-muted-foreground">{labels.path}</span>
            <p className="break-words font-mono text-body-small [overflow-wrap:anywhere]">
              {(target?.path ?? path) || "—"}
            </p>
          </div>
          {error ? (
            <div role="alert" className="text-body-small text-danger">
              {labels[error]}
              {error === "loadError" ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setLoadAttempt((value) => value + 1);
                  }}
                >
                  {labels.retry}
                </Button>
              ) : null}
            </div>
          ) : null}
          <DialogFooter className="flex-col-reverse sm:flex-row">
            <Button
              className="h-11 sm:h-9"
              type="button"
              disabled={busy}
              variant="outline"
              onClick={onClose}
            >
              {labels.cancel}
            </Button>
            <Button
              className="h-11 sm:h-9"
              type="submit"
              disabled={busy || loading || !parent || !valid}
            >
              {busy ? (
                <LoaderCircle className="animate-spin" aria-hidden="true" />
              ) : (
                <FolderPlus aria-hidden="true" />
              )}
              {busy
                ? labels.creating
                : target
                  ? target.created || error === "addError"
                    ? labels.retryAdd
                    : labels.addExisting
                  : labels.create}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
