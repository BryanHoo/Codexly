import { Keyboard } from "lucide-react";

import type { KeyboardShortcutLabels } from "@codexly/frontend-core/keyboard-shortcut-labels";
import { getSplitShortcutDisplayKeys } from "@codexly/frontend-core/split-layout";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./dialog.js";
import {
  getShortcutDisplayKeys,
  WORKBENCH_SHORTCUTS,
  type WorkbenchShortcut,
} from "@codexly/frontend-core/keyboard-shortcuts";

// 功能内快捷键由各自组件处理，此处只展示说明，避免注册为全局命令而抢占输入。
const contextualShortcuts = [
  { id: "splitUp", direction: "up", section: "workspace" },
  { id: "splitDown", direction: "down", section: "workspace" },
  { id: "splitLeft", direction: "left", section: "workspace" },
  { id: "splitRight", direction: "right", section: "workspace" },
  { id: "saveFile", keys: ["Mod", "S"], section: "workspace" },
  { id: "sendMessage", keys: ["Enter"], section: "composer" },
  { id: "insertNewline", keys: ["Shift / Mod", "Enter"], section: "composer" },
  { id: "promptHistory", keys: ["↑ / ↓"], section: "composer" },
  { id: "moveProjectUp", keys: ["Alt", "↑"], section: "navigation" },
  { id: "moveProjectDown", keys: ["Alt", "↓"], section: "navigation" },
] as const;

function ShortcutKeys({ mac, shortcut }: Readonly<{ mac: boolean; shortcut: WorkbenchShortcut }>) {
  return (
    <span className="flex shrink-0 items-center gap-1" aria-hidden="true">
      {getShortcutDisplayKeys(shortcut, mac).map((key) => (
        <kbd
          className="grid h-6 min-w-6 place-items-center rounded-control border border-separator-strong bg-control px-1.5 font-mono text-caption font-medium text-foreground shadow-sm"
          key={key}
        >
          {key}
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

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent aria-describedby={undefined} className="max-w-md gap-0 overflow-y-auto p-0">
        <DialogHeader className="border-b border-separator px-5 py-4">
          <DialogTitle className="flex items-center gap-2">
            <Keyboard aria-hidden="true" className="size-4 text-muted-foreground" />
            {labels.title}
          </DialogTitle>
        </DialogHeader>
        {(platform === "desktop" ? (["general", "view"] as const) : (["general"] as const)).map(
          (section) => (
            <section className="px-5 py-4" key={section}>
              <h2 className="mb-2 text-label font-semibold text-muted-foreground">
                {labels.sections[section]}
              </h2>
              <ul className="divide-y divide-separator">
                {WORKBENCH_SHORTCUTS.filter(
                  (shortcut) =>
                    shortcut.section === section &&
                    (platform === "desktop" || shortcut.id === "searchTasks"),
                ).map((shortcut) => (
                  <li
                    className="flex min-h-10 items-center justify-between gap-4 py-2 text-body-small"
                    key={shortcut.id}
                  >
                    <span>{labels.actions[shortcut.id]}</span>
                    <ShortcutKeys mac={mac} shortcut={shortcut} />
                  </li>
                ))}
              </ul>
            </section>
          ),
        )}
        {(["workspace", "composer", "navigation"] as const).map((section) => (
          <section className="px-5 py-4" key={section}>
            <h2 className="mb-2 text-label font-semibold text-muted-foreground">
              {labels.sections[section]}
            </h2>
            <ul className="divide-y divide-separator">
              {contextualShortcuts
                .filter((shortcut) => shortcut.section === section)
                .map((shortcut) => (
                  <li
                    className="flex min-h-10 items-center justify-between gap-4 py-2 text-body-small"
                    key={shortcut.id}
                  >
                    <span>{labels.actions[shortcut.id]}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      {("direction" in shortcut
                        ? getSplitShortcutDisplayKeys(shortcut.direction, mac)
                        : shortcut.keys
                      ).map((key) => (
                        <kbd
                          className="rounded-control border border-separator-strong bg-control px-1.5 py-1 font-mono text-caption"
                          key={key}
                        >
                          {key.replace("Mod", mac ? "⌘" : "Ctrl").replace("Alt", mac ? "⌥" : "Alt")}
                        </kbd>
                      ))}
                    </span>
                  </li>
                ))}
            </ul>
          </section>
        ))}
      </DialogContent>
    </Dialog>
  );
}
