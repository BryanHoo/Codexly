/* eslint-disable jsx-a11y/no-autofocus -- Dialog 由用户显式打开，分支名输入框是唯一首要操作。 */
import { useRef, useState } from "react";

import { useTranslation } from "../../../i18n/i18n.js";
import { Button } from "../../../shared/components/core/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../shared/components/core/dialog.js";
import { Input } from "../../../shared/components/core/input.js";

type CreateBranchDialogProps = Readonly<{
  isPending: boolean;
  onClose: () => void;
  onCreate: (branch: string) => Promise<boolean>;
}>;

export function CreateBranchDialog({ isPending, onClose, onCreate }: CreateBranchDialogProps) {
  const { t } = useTranslation("workbench");
  const [branch, setBranch] = useState("");
  const submissionRef = useRef(false);
  const normalizedBranch = branch.trim();

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open && !isPending && !submissionRef.current) {
          onClose();
        }
      }}
      open
    >
      <DialogContent
        aria-labelledby="create-branch-title"
        className="max-w-96 p-4"
        onEscapeKeyDown={(event) => {
          if (isPending || submissionRef.current) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (isPending || submissionRef.current) event.preventDefault();
        }}
      >
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (normalizedBranch.length === 0 || submissionRef.current) {
              return;
            }
            // Ref 在事件入口同步单飞，避免 React 提交状态生效前重复触发 Mutation。
            submissionRef.current = true;
            void onCreate(normalizedBranch).then((created) => {
              submissionRef.current = false;
              if (created) {
                onClose();
              }
            });
          }}
        >
          <DialogHeader>
            <DialogTitle id="create-branch-title">{t("composer.createBranch")}</DialogTitle>
            <DialogDescription>{t("composer.createBranchDescription")}</DialogDescription>
          </DialogHeader>
          <label
            className="grid gap-1.5 text-label font-medium text-foreground"
            htmlFor="create-branch-name"
          >
            {t("composer.branchName")}
            <Input
              autoCapitalize="none"
              autoComplete="off"
              autoCorrect="off"
              autoFocus
              disabled={isPending}
              id="create-branch-name"
              maxLength={1_024}
              name="branch"
              onChange={(event) => {
                setBranch(event.currentTarget.value);
              }}
              placeholder="feat/my-feature"
              spellCheck={false}
              value={branch}
              variant="outline"
            />
          </label>
          <DialogFooter>
            <Button disabled={isPending} onClick={onClose} type="button" variant="ghost">
              {t("actions.cancel")}
            </Button>
            <Button disabled={isPending || normalizedBranch.length === 0} type="submit">
              {t("composer.createAndSwitchBranch")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
