import type { ProjectGitStatus } from "@codexly/protocol";
import { ChevronsUpDown, GitBranch, LoaderCircle, Plus } from "lucide-react";
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

type ComposerBranchSwitcherProps = Readonly<{
  creatingBranch: string | undefined;
  gitStatus: ProjectGitStatus | undefined;
  onBranchChange: (branch: string) => void;
  onBranchCreate: (branch: string) => Promise<boolean>;
  switchingBranch: string | undefined;
}>;

export function resolveComposerGitSwitchTargets(
  branches: readonly string[],
  currentBranch: string | null,
) {
  // 当前分支不再列为可切换目标。
  return { branches: branches.filter((branch) => branch !== currentBranch) };
}

export function ComposerBranchSwitcher({
  creatingBranch,
  gitStatus,
  onBranchChange,
  onBranchCreate,
  switchingBranch,
}: ComposerBranchSwitcherProps) {
  const { t } = useTranslation("workbench");
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  if (gitStatus === undefined || gitStatus.repositoryMode === "none") {
    return null;
  }

  const currentBranch = gitStatus.branch;
  const interactive = gitStatus.repositoryMode === "root" && currentBranch !== null;
  const label = currentBranch ?? t("composer.gitBranchMissing");
  const mutationPending = switchingBranch !== undefined || creatingBranch !== undefined;
  const switchTargets = resolveComposerGitSwitchTargets(gitStatus.branches, currentBranch);

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
          <DropdownMenuItem
            disabled={mutationPending}
            onSelect={() => {
              setCreateDialogOpen(true);
            }}
          >
            <Plus aria-hidden="true" className="size-3.5 text-muted-foreground" />
            {t("composer.createBranch")}
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
    </>
  );
}
