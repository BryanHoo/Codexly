import { ExternalLink, X } from "lucide-react";

import { useTranslation } from "../../../i18n/i18n.js";
import { LazyMessageResponse } from "../../../shared/components/agent/lazy-message-response.js";
import { Button } from "../../../shared/components/core/button.js";
import { Dialog, DialogContent, DialogTitle } from "../../../shared/components/core/dialog.js";

export function AppReleaseNotesDialog({
  changelogUrl,
  notes,
  onClose,
  open,
  version,
}: Readonly<{
  changelogUrl: string;
  notes: string;
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
        aria-labelledby="app-release-notes-title"
        className="max-h-[min(80dvh,40rem)] max-w-2xl grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden p-0"
      >
        <header className="flex items-center gap-3 px-5 pt-5">
          <DialogTitle className="min-w-0 flex-1" id="app-release-notes-title">
            {t("about.releaseNotesTitle", { version })}
          </DialogTitle>
          <Button
            aria-label={t("actions.closeReleaseNotes")}
            onClick={onClose}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <X aria-hidden="true" className="size-4" />
          </Button>
        </header>
        <div className="min-h-0 overflow-y-auto border-t border-separator px-5 py-4">
          <LazyMessageResponse className="text-body-small" mode="static">
            {notes}
          </LazyMessageResponse>
        </div>
        <footer className="flex justify-end border-t border-separator px-5 py-3">
          <Button asChild size="sm" variant="link">
            <a href={changelogUrl} rel="noopener noreferrer" target="_blank">
              {t("about.moreReleaseNotes")}
              <ExternalLink aria-hidden="true" data-icon="inline-end" />
            </a>
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
