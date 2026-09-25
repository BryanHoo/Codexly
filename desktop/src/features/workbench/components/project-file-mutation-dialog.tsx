/* oxlint-disable jsx-a11y/no-autofocus -- 用户显式选择重命名后聚焦唯一输入框。 */
import { useState } from "react";

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

type ProjectFileTargetType = "directory" | "file";
type CommonProps = Readonly<{
  isPending: boolean;
  onClose: () => void;
  targetType: ProjectFileTargetType;
}>;

function MutationDialogFrame({
  children,
  isPending,
  onClose,
}: CommonProps & Readonly<{ children: React.ReactNode }>) {
  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open && !isPending) onClose();
      }}
      open
    >
      <DialogContent
        className="max-w-96 p-4"
        onEscapeKeyDown={(event) => {
          if (isPending) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (isPending) event.preventDefault();
        }}
      >
        {children}
      </DialogContent>
    </Dialog>
  );
}

export function ProjectFileRenameDialog({
  initialName,
  isPending,
  onClose,
  onRename,
  targetType,
}: CommonProps & Readonly<{ initialName: string; onRename: (name: string) => void }>) {
  const { t } = useTranslation("workbench");
  const [name, setName] = useState(initialName);
  const normalizedName = name.trim();
  const invalidName =
    normalizedName === "." || normalizedName === ".." || /[/\\]/u.test(normalizedName);
  return (
    <MutationDialogFrame isPending={isPending} onClose={onClose} targetType={targetType}>
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!invalidName && normalizedName !== initialName) onRename(normalizedName);
        }}
      >
        <DialogHeader>
          <DialogTitle>{t("projectFile.renameTitle")}</DialogTitle>
          <DialogDescription>{t(`projectFile.renameDescription.${targetType}`)}</DialogDescription>
        </DialogHeader>
        <Input
          aria-label={t("projectFile.name")}
          autoFocus
          disabled={isPending}
          maxLength={255}
          onChange={(event) => {
            setName(event.currentTarget.value);
          }}
          value={name}
        />
        <DialogFooter>
          <Button disabled={isPending} onClick={onClose} type="button" variant="ghost">
            {t("actions.cancel")}
          </Button>
          <Button
            disabled={
              isPending ||
              invalidName ||
              normalizedName.length === 0 ||
              normalizedName === initialName
            }
            type="submit"
          >
            {t("openMenu.rename")}
          </Button>
        </DialogFooter>
      </form>
    </MutationDialogFrame>
  );
}

export function ProjectFileDeleteDialog({
  isPending,
  name,
  onClose,
  onDelete,
  targetType,
}: CommonProps & Readonly<{ name: string; onDelete: () => void }>) {
  const { t } = useTranslation("workbench");
  return (
    <MutationDialogFrame isPending={isPending} onClose={onClose} targetType={targetType}>
      <DialogHeader>
        <DialogTitle>{t("projectFile.deleteTitle", { name })}</DialogTitle>
        <DialogDescription>{t(`projectFile.deleteDescription.${targetType}`)}</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button disabled={isPending} onClick={onClose} type="button" variant="ghost">
          {t("actions.cancel")}
        </Button>
        <Button disabled={isPending} onClick={onDelete} type="button" variant="destructive">
          {t("openMenu.delete")}
        </Button>
      </DialogFooter>
    </MutationDialogFrame>
  );
}
