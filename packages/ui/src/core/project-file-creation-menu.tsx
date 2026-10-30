import { useRef } from "react";
import { FilePlus, FolderPlus } from "lucide-react";
import { ContextMenuItem, ContextMenuSeparator } from "./context-menu.js";
import { DropdownMenuItem, DropdownMenuSeparator } from "./dropdown-menu.js";

export type ProjectFileCreationMenuProps = Readonly<{
  disabled: boolean;
  labels: Readonly<{ file: string; directory: string }>;
  onCreateFile: () => void;
  onCreateDirectory: () => void;
}>;

export function ProjectFileCreationMenuItems({
  disabled,
  labels,
  onCreateFile,
  onCreateDirectory,
  variant,
}: ProjectFileCreationMenuProps & Readonly<{ variant: "context" | "dropdown" }>) {
  const Item = variant === "context" ? ContextMenuItem : DropdownMenuItem;
  const Separator = variant === "context" ? ContextMenuSeparator : DropdownMenuSeparator;
  return (
    <>
      <Item disabled={disabled} onSelect={onCreateFile}>
        <FilePlus aria-hidden="true" className="size-4 text-muted-foreground" />
        <span>{labels.file}</span>
      </Item>
      <Item disabled={disabled} onSelect={onCreateDirectory}>
        <FolderPlus aria-hidden="true" className="size-4 text-muted-foreground" />
        <span>{labels.directory}</span>
      </Item>
      <Separator />
    </>
  );
}

// 菜单与 Dialog 的关闭/打开可能交错；创建时由 Dialog 独占焦点，避免菜单抢回三点按钮。
export function useProjectFileCreationMenuFocus() {
  const creating = useRef(false);
  return {
    prepareCreation: (action: () => void) => () => {
      creating.current = true;
      action();
    },
    onCloseAutoFocus: (event: Event) => {
      if (creating.current) {
        event.preventDefault();
        creating.current = false;
      }
    },
  };
}
