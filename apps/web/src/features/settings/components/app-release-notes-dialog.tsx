import { useTranslation } from "../../../i18n/i18n.js";
import { LazyMessageResponse } from "../../../shared/components/agent/lazy-message-response.js";
import { Dialog, DialogContent, DialogTitle } from "../../../shared/components/core/dialog.js";

export function AppReleaseNotesDialog({
  notes,
  onClose,
  open,
  version,
}: Readonly<{
  notes: string | null;
  onClose: () => void;
  open: boolean;
  version: string;
}>) {
  const { t } = useTranslation("settings");

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
      open={open}
    >
      <DialogContent
        closeLabel={t("actions.closeReleaseNotes")}
        aria-labelledby="app-release-notes-title"
        className="max-h-[min(80dvh,40rem)] max-w-2xl grid-rows-[auto_minmax(0,1fr)] overflow-hidden p-0"
      >
        <header className="flex items-center gap-3 px-5 pt-5">
          <DialogTitle className="min-w-0 flex-1" id="app-release-notes-title">
            {t("about.releaseNotesTitle", { version })}
          </DialogTitle>
        </header>
        <div className="min-h-0 overflow-y-auto border-t border-separator px-5 py-4">
          {notes === null ? (
            <p className="text-body-small text-muted-foreground">
              {t("about.releaseNotesUnavailable")}
            </p>
          ) : (
            <LazyMessageResponse className="text-body-small" mode="static">
              {notes}
            </LazyMessageResponse>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
