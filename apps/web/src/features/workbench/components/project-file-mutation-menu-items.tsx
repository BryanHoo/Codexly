import { Pencil, Trash2 } from "lucide-react";

import { useTranslation } from "../../../i18n/i18n.js";
import {
  ContextMenuItem,
  ContextMenuSeparator,
} from "../../../shared/components/core/context-menu.js";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "../../../shared/components/core/dropdown-menu.js";

type ProjectFileMutationMenuItemsProps = Readonly<{
  disabled: boolean;
  onDelete: () => void;
  onRename: () => void;
}>;

export function ProjectFileMutationContextMenuItems({
  disabled,
  onDelete,
  onRename,
}: ProjectFileMutationMenuItemsProps) {
  const { t } = useTranslation("workbench");
  return (
    <>
      <ContextMenuSeparator />
      <ContextMenuItem disabled={disabled} onSelect={onRename}>
        <Pencil aria-hidden="true" className="size-4 text-muted-foreground" />
        <span>{t("openMenu.rename")}</span>
      </ContextMenuItem>
      <ContextMenuItem className="text-danger" disabled={disabled} onSelect={onDelete}>
        <Trash2 aria-hidden="true" className="size-4" />
        <span>{t("openMenu.delete")}</span>
      </ContextMenuItem>
    </>
  );
}

export function ProjectFileMutationDropdownMenuItems({
  disabled,
  onDelete,
  onRename,
}: ProjectFileMutationMenuItemsProps) {
  const { t } = useTranslation("workbench");
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuItem disabled={disabled} onSelect={onRename}>
        <Pencil aria-hidden="true" className="size-4 text-muted-foreground" />
        <span>{t("openMenu.rename")}</span>
      </DropdownMenuItem>
      <DropdownMenuItem className="text-danger" disabled={disabled} onSelect={onDelete}>
        <Trash2 aria-hidden="true" className="size-4" />
        <span>{t("openMenu.delete")}</span>
      </DropdownMenuItem>
    </>
  );
}
