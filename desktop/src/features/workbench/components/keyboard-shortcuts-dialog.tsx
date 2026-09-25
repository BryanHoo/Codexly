import { Keyboard } from "lucide-react";

import { useTranslation } from "../../../i18n/i18n.js";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../../../shared/components/core/dialog.js";
import {
  getShortcutDisplayKeys,
  WORKBENCH_SHORTCUTS,
  type WorkbenchShortcut,
} from "../keyboard-shortcuts.js";

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
}: Readonly<{ onOpenChange: (open: boolean) => void; open: boolean }>) {
  const { t } = useTranslation("shortcuts");
  const mac = typeof navigator !== "undefined" && /mac/i.test(navigator.platform);

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent aria-describedby={undefined} className="max-w-md gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-separator px-5 py-4">
          <DialogTitle className="flex items-center gap-2">
            <Keyboard aria-hidden="true" className="size-4 text-muted-foreground" />
            {t("title")}
          </DialogTitle>
        </DialogHeader>
        {(["general", "view"] as const).map((section) => (
          <section className="px-5 py-4" key={section}>
            <h2 className="mb-2 text-label font-semibold text-muted-foreground">
              {t(`sections.${section}`)}
            </h2>
            <ul className="divide-y divide-separator">
              {WORKBENCH_SHORTCUTS.filter((shortcut) => shortcut.section === section).map(
                (shortcut) => (
                  <li
                    className="flex min-h-10 items-center justify-between gap-4 py-2 text-body-small"
                    key={shortcut.id}
                  >
                    <span>{t(`actions.${shortcut.id}`)}</span>
                    <ShortcutKeys mac={mac} shortcut={shortcut} />
                  </li>
                ),
              )}
            </ul>
          </section>
        ))}
      </DialogContent>
    </Dialog>
  );
}
