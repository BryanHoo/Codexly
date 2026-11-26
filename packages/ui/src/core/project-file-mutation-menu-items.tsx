import { Pencil, Trash2 } from "lucide-react";

import { ContextMenuItem, ContextMenuSeparator } from "./context-menu.js";
import { DropdownMenuItem, DropdownMenuSeparator } from "./dropdown-menu.js";

type ProjectFileMutationMenuItemsProps = Readonly<{
  disabled: boolean;
  deleteLabel: string;
  renameLabel: string;
  onDelete: () => void;
  onRename: () => void;
}>;

export function ProjectFileMutationContextMenuItems({
  deleteLabel,
  disabled,
  onDelete,
  onRename,
  renameLabel,
}: ProjectFileMutationMenuItemsProps) {
  return (
    <>
      <ContextMenuSeparator />
      <ContextMenuItem disabled={disabled} onSelect={onRename}>
        <Pencil aria-hidden="true" className="size-4 text-muted-foreground" />
        <span>{renameLabel}</span>
      </ContextMenuItem>
      <ContextMenuItem className="text-danger" disabled={disabled} onSelect={onDelete}>
        <Trash2 aria-hidden="true" className="size-4" />
        <span>{deleteLabel}</span>
      </ContextMenuItem>
    </>
  );
}

export function ProjectFileMutationDropdownMenuItems({
  deleteLabel,
  disabled,
  onDelete,
  onRename,
  renameLabel,
}: ProjectFileMutationMenuItemsProps) {
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuItem disabled={disabled} onSelect={onRename}>
        <Pencil aria-hidden="true" className="size-4 text-muted-foreground" />
        <span>{renameLabel}</span>
      </DropdownMenuItem>
      <DropdownMenuItem className="text-danger" disabled={disabled} onSelect={onDelete}>
        <Trash2 aria-hidden="true" className="size-4" />
        <span>{deleteLabel}</span>
      </DropdownMenuItem>
    </>
  );
}
