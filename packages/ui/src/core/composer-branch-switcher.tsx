import { ChevronsUpDown, GitBranch, LoaderCircle } from "lucide-react";
import { lazy, Suspense, useRef, useState } from "react";
import { isRootGitProject } from "@codexly/frontend-core/project-git-availability";
import type { ComposerGitLabels, ComposerBranchSwitcherProps } from "./composer-git-contracts.js";
import { Button } from "./button.js";
import * as Popover from "radix-ui/popover";

const ComposerGitMenu = lazy(() =>
  import("./composer-git-menu.js").then((module) => ({ default: module.ComposerGitMenu })),
);
export type { ComposerGitLabels, ComposerBranchSwitcherProps } from "./composer-git-contracts.js";

export { resolveComposerGitSwitchTargets } from "@codexly/frontend-core/composer-git-targets";

/** 两端复用分支和 worktree 菜单；仅首次展开时加载列表与创建表单。 */
export function ComposerBranchSwitcher(
  props: ComposerBranchSwitcherProps & {
    labels: ComposerGitLabels;
    onError: (error: unknown) => void;
  },
) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [activated, setActivated] = useState(false);
  const [open, setOpen] = useState(false);
  if (!isRootGitProject(props.gitStatus)) return null;
  const status = props.gitStatus;
  const pending =
    props.disabled === true ||
    props.switchingBranch !== undefined ||
    props.creatingBranch !== undefined;
  const label = status.branch ?? props.labels.missing;
  if (status.branch === null)
    return (
      <span className="inline-flex min-w-0 shrink items-center gap-1">
        <GitBranch aria-hidden="true" className="size-3 shrink-0" />
        <span className="truncate">{label}</span>
      </span>
    );
  return (
    <Popover.Root
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (value) setActivated(true);
      }}
    >
      <Popover.Trigger asChild>
        <Button
          ref={triggerRef}
          aria-label={props.labels.switchLabel}
          className="inline-flex h-6 max-w-28 min-w-0 items-center gap-1 rounded-control px-1 text-caption text-muted-foreground hover:bg-control-hover hover:text-foreground sm:max-w-40"
          disabled={pending}
          type="button"
          variant="ghost"
        >
          {pending ? (
            <LoaderCircle aria-hidden="true" className="size-3 shrink-0 animate-spin" />
          ) : (
            <GitBranch aria-hidden="true" className="size-3 shrink-0" />
          )}
          <span className="truncate">{label}</span>
          <ChevronsUpDown aria-hidden="true" className="size-3 shrink-0" />
        </Button>
      </Popover.Trigger>
      {activated ? (
        <Suspense fallback={null}>
          <ComposerGitMenu
            {...props}
            open={open}
            pending={pending}
            onOpenChange={setOpen}
            restoreFocus={() => {
              triggerRef.current?.focus();
            }}
          />
        </Suspense>
      ) : null}
    </Popover.Root>
  );
}
