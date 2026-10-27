import {
  ComposerBranchSwitcher as SharedComposerBranchSwitcher,
  type ComposerBranchSwitcherProps,
} from "@codexly/ui/core/composer-branch-switcher";
import { useTranslation } from "../../../i18n/i18n.js";
import { notifyActionError } from "../../notifications/action-notifications.js";
export {
  resolveComposerGitSwitchTargets,
  type ComposerBranchSwitcherProps,
} from "@codexly/ui/core/composer-branch-switcher";

export function ComposerBranchSwitcher(props: ComposerBranchSwitcherProps) {
  const { t } = useTranslation("workbench");
  return (
    <SharedComposerBranchSwitcher
      {...props}
      onError={notifyActionError}
      labels={{
        switchLabel: t("composer.branchSwitcherLabel", { branch: props.gitStatus?.branch ?? "" }),
        missing: t("composer.gitBranchMissing"),
        branches: t("composer.gitBranches"),
        pickerTitle: t("composer.gitPickerTitle"),
        current: t("composer.gitCurrent"),
        mainWorktree: t("composer.gitMainWorktree"),
        worktreeHint: t("composer.gitWorktreeHint"),
        branchHint: t("composer.gitBranchHint"),
        searchWorktrees: t("composer.gitSearchWorktrees"),
        searchBranches: t("composer.gitSearchBranches"),
        noResults: t("composer.gitNoResults"),
        occupied: t("composer.gitOccupied"),
        retry: t("composer.gitRetry"),
        loadError: t("composer.gitLoadError"),
        baseBranch: t("composer.gitBaseBranch"),
        location: t("composer.gitLocation"),
        worktrees: t("composer.worktrees"),
        createBranch: t("composer.createBranch"),
        branchDescription: t("composer.createBranchDescription"),
        createBranchConfirm: t("composer.createAndSwitchBranch"),
        createWorktree: t("composer.createWorktree"),
        worktreeDescription: t("composer.createWorktreeDescription"),
        createWorktreeConfirm: t("composer.createWorktreeConfirm"),
        branchName: t("composer.branchName"),
        cancel: t("actions.cancel"),
        close: t("actions.close"),
        loading: t("composer.worktreeLoading"),
      }}
    />
  );
}
