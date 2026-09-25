import { GitFork, Plus } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { useTranslation } from "../../../i18n/i18n.js";
import { DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator } from "../../../shared/components/core/dropdown-menu.js";
import { resolveComposerGitSwitchTargets, type ComposerBranchSwitcherProps } from "./composer-branch-switcher.js";

const CreateBranchDialog = lazy(() => import("./create-branch-dialog.js").then((module) => ({ default: module.CreateBranchDialog })));
const CreateWorktreeDialog = lazy(() => import("./create-worktree-dialog.js").then((module) => ({ default: module.CreateWorktreeDialog })));

export function ComposerBranchMenu({ creatingBranch, creatingWorktree, gitStatus, mutationPending, onBranchChange, onBranchCreate, onWorktreeChange, onWorktreeCreate, worktrees }: ComposerBranchSwitcherProps & { mutationPending: boolean }) {
  const { t } = useTranslation("workbench");
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createWorktreeDialogOpen, setCreateWorktreeDialogOpen] = useState(false);
  const targets = resolveComposerGitSwitchTargets(gitStatus?.branches ?? [], gitStatus?.branch ?? null, worktrees);
  return <>
    <DropdownMenuContent align="start" className="max-h-72 w-72 max-w-[calc(100vw-1rem)] overflow-y-auto" side="top">
      {targets.branches.length === 0 ? null : <>
        <DropdownMenuGroup><DropdownMenuLabel>{t("composer.branchSwitcherMenu")}</DropdownMenuLabel></DropdownMenuGroup>
        <DropdownMenuRadioGroup onValueChange={onBranchChange}>
          {targets.branches.map((branch) => <DropdownMenuRadioItem disabled={mutationPending} key={branch} title={branch} value={branch}><span className="truncate">{branch}</span></DropdownMenuRadioItem>)}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
      </>}
      {targets.worktrees.length === 0 ? null : <>
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t("composer.worktreeSwitcherMenu")}</DropdownMenuLabel>
          {targets.worktrees.map((worktree) => <DropdownMenuItem disabled={mutationPending} key={worktree.path} onSelect={() => onWorktreeChange(worktree.path)} title={worktree.path}>
            <GitFork aria-hidden="true" className="size-3.5" /><span className="grid min-w-0 flex-1"><span className="truncate">{worktree.branch ?? t("composer.detachedHead")}</span><span className="truncate text-caption text-muted-foreground">{worktree.path}</span></span>
          </DropdownMenuItem>)}
        </DropdownMenuGroup><DropdownMenuSeparator />
      </>}
      <DropdownMenuItem disabled={mutationPending} onSelect={() => setCreateDialogOpen(true)}><Plus aria-hidden="true" className="size-3.5 text-muted-foreground" />{t("composer.createBranch")}</DropdownMenuItem>
      <DropdownMenuItem disabled={mutationPending} onSelect={() => setCreateWorktreeDialogOpen(true)}><GitFork aria-hidden="true" className="size-3.5 text-muted-foreground" />{t("composer.createWorktree")}</DropdownMenuItem>
    </DropdownMenuContent>
    {createDialogOpen ? <Suspense fallback={null}><CreateBranchDialog isPending={creatingBranch !== undefined} onClose={() => setCreateDialogOpen(false)} onCreate={onBranchCreate} /></Suspense> : null}
    {createWorktreeDialogOpen ? <Suspense fallback={null}><CreateWorktreeDialog isPending={creatingWorktree !== undefined} onClose={() => setCreateWorktreeDialogOpen(false)} onCreate={onWorktreeCreate} /></Suspense> : null}
  </>;
}
