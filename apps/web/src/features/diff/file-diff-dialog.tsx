import { FileCode2, X } from "lucide-react";
import { lazy, Suspense } from "react";

import { Button } from "../../shared/components/core/button.js";
import { Dialog, DialogContent, DialogTitle } from "../../shared/components/core/dialog.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../shared/components/core/tooltip.js";
import { useTranslation } from "../../i18n/i18n.js";
import type { AgentFileChange } from "./file-change.js";
import { countFileChangeLines, getFileName } from "./file-change.js";

const PatchDiffViewer = lazy(() => import("./patch-diff-viewer.js"));

type FileDiffDialogProps = Readonly<{
  change: AgentFileChange | null;
  onClose: () => void;
}>;

export function FileDiffDialog({ change, onClose }: FileDiffDialogProps) {
  const { t } = useTranslation("workbench");

  if (change === null) {
    return null;
  }

  const fileName = getFileName(change.path);
  const { additions, removals } = countFileChangeLines(change);
  const titleId = "file-diff-dialog-title";

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      open
    >
      <DialogContent
        aria-labelledby={titleId}
        className="h-[min(82dvh,54rem)] max-w-[72rem] overflow-hidden p-0"
      >
        <section className="grid h-full min-h-0 w-full min-w-0 grid-rows-[auto_minmax(0,1fr)] bg-raised">
          <header className="flex min-w-0 min-h-toolbar items-center gap-3 px-3 shadow-toolbar sm:px-4">
            <FileCode2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <DialogTitle className="truncate text-body-small" id={titleId} title={change.path}>
                {fileName}
              </DialogTitle>
              <p className="truncate text-caption text-muted-foreground" title={change.path}>
                {change.path}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2 text-label font-medium">
              <span className="text-diff-added">+{additions}</span>
              <span className="text-diff-removed">-{removals}</span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    aria-label={t("diff.close")}
                    onClick={onClose}
                    size="icon-sm"
                    type="button"
                    variant="ghost"
                  >
                    <X className="size-3.5" aria-hidden="true" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("diff.close")}</TooltipContent>
              </Tooltip>
            </div>
          </header>
          <div className="min-h-0 min-w-0 overflow-auto bg-content">
            <Suspense
              fallback={
                <div
                  className="grid min-h-48 place-items-center text-body-small text-muted-foreground"
                  role="status"
                >
                  {t("diff.loading")}
                </div>
              }
            >
              <PatchDiffViewer change={change} />
            </Suspense>
          </div>
        </section>
      </DialogContent>
    </Dialog>
  );
}
