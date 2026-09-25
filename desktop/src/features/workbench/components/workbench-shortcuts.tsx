import { useEffect, useEffectEvent } from "react";

import {
  matchesShortcut,
  WORKBENCH_SHORTCUTS,
  type WorkbenchShortcutId,
} from "../keyboard-shortcuts.js";

type ShortcutActions = Partial<Record<WorkbenchShortcutId, (() => void) | undefined>>;

type WorkbenchShortcutsProps = Readonly<{
  onNewTask?: () => void;
  onOpenSettings?: () => void;
  onSearchTasks?: () => void;
  onShowShortcuts?: () => void;
  onToggleInspector?: () => void;
  onToggleSidebar?: () => void;
}>;

function hasVisibleModal(): boolean {
  return [...document.querySelectorAll('[role="dialog"], [role="alertdialog"], dialog[open]')].some(
    (element) => element.getClientRects().length > 0,
  );
}

export function WorkbenchShortcuts({
  onNewTask,
  onOpenSettings,
  onSearchTasks,
  onShowShortcuts,
  onToggleInspector,
  onToggleSidebar,
}: WorkbenchShortcutsProps) {
  const invokeShortcut = useEffectEvent((id: WorkbenchShortcutId): boolean => {
    const actions: ShortcutActions = {
      newTask: onNewTask,
      openSettings: onOpenSettings,
      searchTasks: onSearchTasks,
      showShortcuts: onShowShortcuts,
      toggleInspector: onToggleInspector,
      toggleSidebar: onToggleSidebar,
    };
    const action = actions[id];
    if (action === undefined) return false;
    action();
    return true;
  });

  useEffect(() => {
    const mac = /mac/i.test(navigator.platform);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (hasVisibleModal()) return;
      const shortcut = WORKBENCH_SHORTCUTS.find((candidate) =>
        matchesShortcut(event, candidate, mac),
      );
      if (shortcut === undefined || !invokeShortcut(shortcut.id)) return;

      // 全局命令一旦命中即截断传播，避免编辑器或系统 WebView 同时处理同一组合键。
      event.preventDefault();
      event.stopPropagation();
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, []);

  return null;
}
