import type { ProjectGitStatus, ProjectGitWorktree } from "@codexly/protocol";
import { ChevronsUpDown, GitBranch, GitFork, LoaderCircle, Plus } from "lucide-react";
import { useState } from "react";

import { useTranslation } from "../../../i18n/i18n.js";
import { Button } from "../../../shared/components/core/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../../shared/components/core/dropdown-menu.js";
import { CreateBranchDialog } from "./create-branch-dialog.js";
import { CreateWorktreeDialog } from "./create-worktree-dialog.js";

type ComposerBranchSwitcherProps = Readonly<{
  creatingBranch: string | undefined;
  creatingWorktree: string | undefined;
  gitStatus: ProjectGitStatus | undefined;
  onBranchChange: (branch: string) => void;
  onBranchCreate: (branch: string) => Promise<boolean>;
  onWorktreeChange: (path: string) => void;
  onWorktreeCreate: (branch: string) => Promise<boolean>;
  switchingBranch: string | undefined;
  switchingWorktree: string | undefined;
  worktrees: readonly ProjectGitWorktree[];
}>;

export function resolveComposerGitSwitchTargets(
  branches: readonly string[],
  currentBranch: string | null,
  worktrees: readonly ProjectGitWorktree[],
) {
  // 当前项无法再次切换；过滤后为空时，对应切换模块没有展示价值。
  return {
    branches: branches.filter((branch) => branch !== currentBranch),
    worktrees: worktrees.filter((worktree) => !worktree.current),
  };
}

export function ComposerBranchSwitcher({
  creatingBranch,
  creatingWorktree,
  gitStatus,
  onBranchChange,
  onBranchCreate,
  onWorktreeChange,
  onWorktreeCreate,
  switchingBranch,
  switchingWorktree,
  worktrees,
}: ComposerBranchSwitcherProps) {
  const { t } = useTranslation("workbench");
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createWorktreeDialogOpen, setCreateWorktreeDialogOpen] = useState(false);

  if (gitStatus === undefined || gitStatus.repositoryMode === "none") {
    return null;
  }

  const currentBranch = gitStatus.branch;
  const interactive = gitStatus.repositoryMode === "root" && currentBranch !== null;
  const label = currentBranch ?? t("composer.gitBranchMissing");
  const mutationPending =
    switchingBranch !== undefined ||
    creatingBranch !== undefined ||
    switchingWorktree !== undefined ||
    creatingWorktree !== undefined;
  const switchTargets = resolveComposerGitSwitchTargets(
    gitStatus.branches,
    currentBranch,
    worktrees,
  );

  if (!interactive) {
    return (
      <span className="inline-flex min-w-0 shrink items-center gap-1">
        <GitBranch aria-hidden="true" className="size-3 shrink-0" />
        <span className="truncate">{label}</span>
      </span>
    );
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label={t("composer.branchSwitcherLabel", { branch: currentBranch })}
            className="inline-flex h-6 max-w-28 min-w-0 items-center gap-1 rounded-control px-1 text-caption text-muted-foreground hover:bg-control-hover hover:text-foreground sm:max-w-40"
            disabled={mutationPending}
            type="button"
            variant="ghost"
          >
            {!mutationPending ? (
              <GitBranch aria-hidden="true" className="size-3 shrink-0" data-icon="inline-start" />
            ) : (
              <LoaderCircle
                aria-hidden="true"
                className="size-3 shrink-0 animate-spin"
                data-icon="inline-start"
              />
            )}
            <span className="truncate">{label}</span>
            <ChevronsUpDown aria-hidden="true" className="size-3 shrink-0" data-icon="inline-end" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="max-h-72 w-72 max-w-[calc(100vw-1rem)] overflow-y-auto"
          side="top"
        >
          {switchTargets.branches.length === 0 ? null : (
            <>
              <DropdownMenuGroup>
                <DropdownMenuLabel>{t("composer.branchSwitcherMenu")}</DropdownMenuLabel>
              </DropdownMenuGroup>
              <DropdownMenuRadioGroup onValueChange={onBranchChange}>
                {switchTargets.branches.map((branch) => (
                  <DropdownMenuRadioItem
                    disabled={mutationPending}
                    key={branch}
                    title={branch}
                    value={branch}
                  >
                    <span className="truncate">{branch}</span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
            </>
          )}
          {switchTargets.worktrees.length === 0 ? null : (
            <>
              <DropdownMenuGroup>
                <DropdownMenuLabel>{t("composer.worktreeSwitcherMenu")}</DropdownMenuLabel>
                {switchTargets.worktrees.map((worktree) => (
                  <DropdownMenuItem
                    disabled={mutationPending}
                    key={worktree.path}
                    onSelect={() => {
                      onWorktreeChange(worktree.path);
                    }}
                    title={worktree.path}
                  >
                    <GitFork aria-hidden="true" className="size-3.5" />
                    <span className="grid min-w-0 flex-1">
                      <span className="truncate">
                        {worktree.branch ?? t("composer.detachedHead")}
                      </span>
                      <span className="truncate text-caption text-muted-foreground">
                        {worktree.path}
                      </span>
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem
            disabled={mutationPending}
            onSelect={() => {
              setCreateDialogOpen(true);
            }}
          >
            <Plus aria-hidden="true" className="size-3.5 text-muted-foreground" />
            {t("composer.createBranch")}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={mutationPending}
            onSelect={() => {
              setCreateWorktreeDialogOpen(true);
            }}
          >
            <GitFork aria-hidden="true" className="size-3.5 text-muted-foreground" />
            {t("composer.createWorktree")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {createDialogOpen ? (
        <CreateBranchDialog
          isPending={creatingBranch !== undefined}
          onClose={() => {
            setCreateDialogOpen(false);
          }}
          onCreate={onBranchCreate}
        />
      ) : null}
      {createWorktreeDialogOpen ? (
        <CreateWorktreeDialog
          isPending={creatingWorktree !== undefined}
          onClose={() => {
            setCreateWorktreeDialogOpen(false);
          }}
          onCreate={onWorktreeCreate}
        />
      ) : null}
    </>
  );
}
