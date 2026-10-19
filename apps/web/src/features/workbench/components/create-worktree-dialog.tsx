import type { ComponentProps } from "react";
import { CreateWorktreeDialog as SharedCreateWorktreeDialog } from "@codexly/ui/core/create-worktree-dialog";
import { useTranslation } from "../../../i18n/i18n.js";

/** 两端共用目录创建表单与提交锁，宿主仅提供本地化文案。 */
export function CreateWorktreeDialog(
  props: Omit<ComponentProps<typeof SharedCreateWorktreeDialog>, "labels">,
) {
  const { t } = useTranslation("workbench");
  return (
    <SharedCreateWorktreeDialog
      {...props}
      labels={{
        title: t("composer.createWorktree"),
        description: t("composer.createWorktreeDescription"),
        branch: t("composer.branchName"),
        cancel: t("actions.cancel"),
        create: t("composer.createWorktreeConfirm"),
      }}
    />
  );
}
