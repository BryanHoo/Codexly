import { useTranslation } from "../../../i18n/i18n.js";
import { Button } from "../../../shared/components/core/button.js";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../../shared/components/core/dialog.js";

export function ProjectDraftConfirm({ onClose, onApply }: { onClose: () => void; onApply: () => void }) {
  const { t } = useTranslation("workbench");
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="max-w-96 p-4">
      <DialogHeader><DialogTitle>{t("composer.applyDraftTitle")}</DialogTitle><DialogDescription>{t("composer.applyDraftDescription")}</DialogDescription></DialogHeader>
      <DialogFooter>
        <Button onClick={onClose} type="button" variant="ghost">{t("actions.cancel")}</Button>
        <Button onClick={onApply} type="button">{t("composer.applyDraft")}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
