export type WorkbenchShortcutId =
  | "newTask"
  | "searchTasks"
  | "toggleSidebar"
  | "toggleInspector"
  | "toggleTerminal"
  | "openSettings"
  | "showShortcuts";

export type WorkbenchShortcut = Readonly<{
  id: WorkbenchShortcutId;
  key: string;
  section: "general" | "view";
}>;

type ShortcutEvent = Pick<
  KeyboardEvent,
  | "altKey"
  | "ctrlKey"
  | "defaultPrevented"
  | "isComposing"
  | "key"
  | "metaKey"
  | "repeat"
  | "shiftKey"
>;

export const WORKBENCH_SHORTCUTS: readonly WorkbenchShortcut[] = [
  { id: "newTask", key: "n", section: "general" },
  { id: "searchTasks", key: "f", section: "general" },
  { id: "toggleSidebar", key: "b", section: "view" },
  { id: "toggleInspector", key: ".", section: "view" },
  { id: "toggleTerminal", key: "j", section: "view" },
  { id: "openSettings", key: ",", section: "general" },
  { id: "showShortcuts", key: "/", section: "general" },
] as const;

export function matchesShortcut(
  event: ShortcutEvent,
  shortcut: WorkbenchShortcut,
  mac: boolean,
): boolean {
  if (
    event.defaultPrevented ||
    event.isComposing ||
    event.repeat ||
    event.altKey ||
    event.shiftKey
  ) {
    return false;
  }
  const primaryModifier = mac
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey;
  return primaryModifier && event.key.toLocaleLowerCase() === shortcut.key;
}

export function getShortcutDisplayKeys(
  shortcut: WorkbenchShortcut,
  mac: boolean,
): readonly string[] {
  return [mac ? "⌘" : "Ctrl", shortcut.key.toLocaleUpperCase()];
}

export function getShortcutAriaKeys(shortcut: WorkbenchShortcut): string {
  return `Meta+${shortcut.key.toLocaleUpperCase()} Control+${shortcut.key.toLocaleUpperCase()}`;
}
