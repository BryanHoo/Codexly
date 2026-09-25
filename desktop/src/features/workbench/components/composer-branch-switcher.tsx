import type { ProjectGitStatus, ProjectGitWorktree } from "@/protocol/index.js";
import { ChevronsUpDown, GitBranch, LoaderCircle } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { useTranslation } from "../../../i18n/i18n.js";
import { Button } from "../../../shared/components/core/button.js";
import { DropdownMenu, DropdownMenuTrigger } from "../../../shared/components/core/dropdown-menu.js";

// 底栏只加载当前分支入口；菜单和创建表单在第一次打开后才加载。
const ComposerBranchMenu = lazy(() => import("./composer-branch-menu.js").then((module) => ({ default: module.ComposerBranchMenu })));

export type ComposerBranchSwitcherProps = Readonly<{
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

export function resolveComposerGitSwitchTargets(branches: readonly string[], currentBranch: string | null, worktrees: readonly ProjectGitWorktree[]) {
  // 当前项无法再次切换；过滤后为空时，对应切换模块没有展示价值。
  return { branches: branches.filter((branch) => branch !== currentBranch), worktrees: worktrees.filter((worktree) => !worktree.current) };
}

export function ComposerBranchSwitcher(props: ComposerBranchSwitcherProps) {
  const { creatingBranch, creatingWorktree, gitStatus, switchingBranch, switchingWorktree } = props;
  const { t } = useTranslation("workbench");
  const [activated, setActivated] = useState(false);
  if (gitStatus === undefined || gitStatus.repositoryMode === "none") return null;
  const currentBranch = gitStatus.branch;
  const interactive = gitStatus.repositoryMode === "root" && currentBranch !== null;
  const label = currentBranch ?? t("composer.gitBranchMissing");
  const mutationPending = switchingBranch !== undefined || creatingBranch !== undefined || switchingWorktree !== undefined || creatingWorktree !== undefined;
  if (!interactive) return <span className="inline-flex min-w-0 shrink items-center gap-1"><GitBranch aria-hidden="true" className="size-3 shrink-0" /><span className="truncate">{label}</span></span>;
  return <DropdownMenu onOpenChange={(open) => { if (open) setActivated(true); }}>
    <DropdownMenuTrigger asChild>
      <Button aria-label={t("composer.branchSwitcherLabel", { branch: currentBranch })} className="inline-flex h-6 max-w-28 min-w-0 items-center gap-1 rounded-control px-1 text-caption text-muted-foreground hover:bg-control-hover hover:text-foreground sm:max-w-40" disabled={mutationPending} type="button" variant="ghost">
        {!mutationPending ? <GitBranch aria-hidden="true" className="size-3 shrink-0" data-icon="inline-start" /> : <LoaderCircle aria-hidden="true" className="size-3 shrink-0 animate-spin" data-icon="inline-start" />}
        <span className="truncate">{label}</span><ChevronsUpDown aria-hidden="true" className="size-3 shrink-0" data-icon="inline-end" />
      </Button>
    </DropdownMenuTrigger>
    {activated ? <Suspense fallback={null}><ComposerBranchMenu {...props} mutationPending={mutationPending} /></Suspense> : null}
  </DropdownMenu>;
}
