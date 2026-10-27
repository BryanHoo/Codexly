import { formatDisplayPath } from "@codexly/frontend-core/display-path";
import { FolderGit2, GitBranch, LoaderCircle } from "lucide-react";
import { useRef, useState } from "react";

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

type CreateWorktreeDialogProps = Readonly<{
  branchLocked?: boolean;
  initialBranch?: string;
  restoreFocus?: () => void;
  context?: Readonly<{
    branch: string;
    branchLabel: string;
    location?: string;
    locationLabel: string;
  }>;
  isPending: boolean;
  onClose: () => void;
  onCreate: (branch: string) => Promise<boolean>;
  labels: Readonly<{
    title: string;
    description: string;
    branch: string;
    cancel: string;
    close: string;
    create: string;
  }>;
}>;

export function CreateWorktreeDialog({
  branchLocked = false,
  initialBranch = "",
  restoreFocus,
  context,
  isPending,
  onClose,
  onCreate,
  labels,
}: CreateWorktreeDialogProps) {
  const [branch, setBranch] = useState(initialBranch);
  const submissionRef = useRef(false);
  const normalizedBranch = branch.trim();

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open && !isPending && !submissionRef.current) onClose();
      }}
      open
    >
      <DialogContent
        closeLabel={labels.close}
        closeDisabled={isPending}
        aria-labelledby="create-worktree-title"
        className="max-w-96 p-4"
        onCloseAutoFocus={(event) => {
          if (restoreFocus) {
            event.preventDefault();
            restoreFocus();
          }
        }}
        onEscapeKeyDown={(event) => {
          if (isPending || submissionRef.current) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (isPending || submissionRef.current) event.preventDefault();
        }}
      >
        <form
          className="grid gap-3.5"
          aria-busy={isPending}
          onSubmit={(event) => {
            event.preventDefault();
            if (normalizedBranch.length === 0 || isPending || submissionRef.current) return;
            // Ref 在事件入口同步单飞，避免 React 状态提交前重复创建目录。
            submissionRef.current = true;
            void onCreate(normalizedBranch).then((created) => {
              submissionRef.current = false;
              if (created) onClose();
            });
          }}
        >
          <DialogHeader>
            <div className="flex items-center gap-2">
              {context?.location ? (
                <FolderGit2
                  aria-hidden="true"
                  className="size-3.5 shrink-0 text-muted-foreground"
                />
              ) : (
                <GitBranch aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
              )}
              <DialogTitle id="create-worktree-title" className="text-body-small font-medium">
                {labels.title}
              </DialogTitle>
            </div>
            <DialogDescription className="text-label">{labels.description}</DialogDescription>
          </DialogHeader>
          <label
            className="grid gap-1 text-label font-medium text-foreground"
            htmlFor="create-worktree-branch"
          >
            {labels.branch}
            <Input
              autoCapitalize="none"
              autoComplete="off"
              autoCorrect="off"
              autoFocus
              disabled={isPending || branchLocked}
              id="create-worktree-branch"
              maxLength={1_024}
              name="branch"
              onChange={(event) => {
                setBranch(event.currentTarget.value);
              }}
              placeholder="feat/my-feature"
              spellCheck={false}
              value={branch}
              variant="outline"
              className="h-7 text-label sm:h-7 pointer-coarse:h-9"
            />
          </label>
          {context ? (
            <dl className="grid min-w-0 gap-2 rounded-control border border-separator bg-control px-2.5 py-2 text-caption">
              <div className="flex min-w-0 items-center justify-between gap-3">
                <dt className="shrink-0 text-muted-foreground">{context.branchLabel}</dt>
                <dd
                  className="flex min-w-0 items-center gap-1.5 font-medium"
                  title={context.branch}
                >
                  <GitBranch aria-hidden="true" className="size-3 shrink-0" />
                  <span className="truncate">{context.branch}</span>
                </dd>
              </div>
              {context.location ? (
                <div className="grid min-w-0 gap-1">
                  <dt className="text-muted-foreground">{context.locationLabel}</dt>
                  <dd className="break-all font-mono text-meta text-foreground">
                    {formatDisplayPath(context.location)}
                  </dd>
                </div>
              ) : null}
            </dl>
          ) : null}
          <DialogFooter>
            <Button
              disabled={isPending}
              onClick={onClose}
              type="button"
              variant="ghost"
              size="sm"
              className="pointer-coarse:h-9"
            >
              {labels.cancel}
            </Button>
            <Button
              disabled={isPending || normalizedBranch.length === 0}
              type="submit"
              size="sm"
              className="pointer-coarse:h-9"
            >
              {isPending ? (
                <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
              ) : null}
              {labels.create}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
