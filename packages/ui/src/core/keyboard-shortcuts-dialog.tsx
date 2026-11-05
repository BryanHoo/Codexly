import { Keyboard } from "lucide-react";

import type { KeyboardShortcutLabels } from "@codexly/frontend-core/keyboard-shortcut-labels";
import { getSplitShortcutDisplayKeys } from "@codexly/frontend-core/split-layout";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./dialog.js";
import {
  getShortcutDisplayKeys,
  WORKBENCH_SHORTCUTS,
} from "@codexly/frontend-core/keyboard-shortcuts";

// 功能内快捷键由各自组件处理，此处只展示说明，避免抢占输入。
const contextualShortcuts = [
  { id: "splitLeft", direction: "left", section: "workspace" },
  { id: "splitUp", direction: "up", section: "workspace" },
  { id: "splitDown", direction: "down", section: "workspace" },
  { id: "splitRight", direction: "right", section: "workspace" },
  { id: "saveFile", keys: ["Mod", "S"], section: "workspace" },
  { id: "sendMessage", keys: ["Enter"], section: "composer" },
  { id: "insertNewline", keys: ["Shift / Mod", "Enter"], section: "composer" },
  { id: "promptHistory", keys: ["↑ / ↓"], section: "composer" },
  { id: "moveProjectUp", keys: ["Alt", "↑"], section: "navigation" },
  { id: "moveProjectDown", keys: ["Alt", "↓"], section: "navigation" },
] as const;

function ShortcutKeys({ keys, mac }: Readonly<{ keys: readonly string[]; mac: boolean }>) {
  return (
    <span className="flex shrink-0 items-center gap-1 whitespace-nowrap">
      {keys.map((key) => (
        <kbd
          className="grid h-6 min-w-6 place-items-center rounded-md border border-separator-strong bg-control px-1.5 font-mono text-caption font-medium text-foreground shadow-sm"
          key={key}
        >
          {key.replace("Mod", mac ? "⌘" : "Ctrl").replace("Alt", mac ? "⌥" : "Alt")}
        </kbd>
      ))}
    </span>
  );
}

export function KeyboardShortcutsDialog({
  onOpenChange,
  open,
  labels,
  platform = "desktop",
}: Readonly<{
  onOpenChange: (open: boolean) => void;
  open: boolean;
  labels: KeyboardShortcutLabels;
  platform?: "web" | "desktop";
}>) {
  const mac = typeof navigator !== "undefined" && /mac/i.test(navigator.platform);
  // 各列独立堆叠，避免网格行随另一列较高的分组产生大块空白；窄屏按阅读顺序回流。
  const columns =
    platform === "desktop"
      ? ([
          ["general", "view", "navigation"],
          ["workspace", "composer"],
        ] as const)
      : ([["general", "composer", "navigation"], ["workspace"]] as const);

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        closeLabel={labels.close}
        aria-describedby={undefined}
        className="flex max-h-[min(42rem,calc(100dvh-2rem))] max-w-[52rem] flex-col gap-0 overflow-hidden p-0"
      >
        <DialogHeader className="shrink-0 border-b border-separator px-5 py-4 sm:px-6">
          <DialogTitle className="flex items-center gap-2">
            <Keyboard aria-hidden="true" className="size-4 text-muted-foreground" />
            {labels.title}
          </DialogTitle>
        </DialogHeader>
        <div
          className="min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-5"
          data-shortcuts-scroll
        >
          <div className="grid gap-3 min-[720px]:grid-cols-2">
            {columns.map((sections, column) => (
              <div className="flex min-w-0 flex-col gap-3" key={column}>
                {sections.map((section) => (
                  <section
                    className="min-w-0 rounded-lg border border-separator bg-control/30 px-4 py-3"
                    key={section}
                  >
                    <h2 className="text-body-small font-semibold">{labels.sections[section]}</h2>
                    {section !== "general" && section !== "view" ? (
                      <p className="mt-1 text-caption leading-relaxed text-muted-foreground">
                        {labels.sectionDescriptions[section]}
                      </p>
                    ) : null}
                    <ul className="mt-2 divide-y divide-separator">
                      {WORKBENCH_SHORTCUTS.filter(
                        (shortcut) =>
                          shortcut.section === section &&
                          (platform === "desktop" || shortcut.id === "searchTasks"),
                      ).map((shortcut) => (
                        <li
                          className="flex min-h-8 items-center justify-between gap-3 py-1 text-body-small"
                          key={shortcut.id}
                        >
                          <span className="min-w-0">{labels.actions[shortcut.id]}</span>
                          <ShortcutKeys keys={getShortcutDisplayKeys(shortcut, mac)} mac={mac} />
                        </li>
                      ))}
                      {contextualShortcuts
                        .filter((shortcut) => shortcut.section === section)
                        .map((shortcut) => (
                          <li
                            className="flex min-h-8 items-center justify-between gap-3 py-1 text-body-small"
                            key={shortcut.id}
                          >
                            <span className="min-w-0">{labels.actions[shortcut.id]}</span>
                            <ShortcutKeys
                              keys={
                                "direction" in shortcut
                                  ? getSplitShortcutDisplayKeys(shortcut.direction, mac)
                                  : shortcut.keys
                              }
                              mac={mac}
                            />
                          </li>
                        ))}
                    </ul>
                  </section>
                ))}
              </div>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-separator px-5 py-3 text-caption text-muted-foreground">
          <ShortcutKeys keys={["Esc"]} mac={mac} />
          <span>{labels.close}</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
