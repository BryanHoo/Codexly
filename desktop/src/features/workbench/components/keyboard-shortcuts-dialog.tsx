import { KeyboardShortcutsDialog as SharedKeyboardShortcutsDialog } from "@codexly/ui/core/keyboard-shortcuts-dialog";
import {
  keyboardShortcutChinese,
  keyboardShortcutEnglish,
} from "@codexly/frontend-core/keyboard-shortcut-labels";
import { useTranslation } from "../../../i18n/i18n.js";

export function KeyboardShortcutsDialog(
  props: Readonly<{ onOpenChange: (open: boolean) => void; open: boolean }>,
) {
  const { i18n } = useTranslation("shortcuts");
  return (
    <SharedKeyboardShortcutsDialog
      {...props}
      labels={
        i18n.resolvedLanguage?.startsWith("en") ? keyboardShortcutEnglish : keyboardShortcutChinese
      }
    />
  );
}
