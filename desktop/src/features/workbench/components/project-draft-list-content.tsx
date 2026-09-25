import { Trash2 } from "lucide-react";
import { useTranslation } from "../../../i18n/i18n.js";
import { Button } from "../../../shared/components/core/button.js";
import { PopoverContent } from "../../../shared/components/core/popover.js";
import type { ProjectDraftRecord } from "../project-draft-store.js";
import { getProjectDraftSummary } from "../project-draft-summary.js";

export function ProjectDraftListContent({ drafts, label, onDelete, onRestore }: { drafts: readonly ProjectDraftRecord[]; label: string; onDelete: (id: string) => void; onRestore: (id: string) => void }) {
  const { t, i18n } = useTranslation("workbench");
  return <PopoverContent aria-label={label} className="w-96 max-w-[calc(100vw-2rem)] overflow-hidden p-0" role="dialog" side="top">
    <div className="border-b border-separator px-3 py-2 text-label font-medium">{label}</div>
    <div className="max-h-72 overflow-y-auto p-1" role="list">
      {drafts.map((draft) => {
        const summary = getProjectDraftSummary(draft, t("composer.attachmentCount", { count: draft.draft.attachments.length }));
        return <div className="group flex h-11 min-w-0 items-center gap-1" key={draft.id} role="listitem">
          <Button aria-label={summary} className="h-full min-w-0 flex-1 px-2 py-1" contentAlign="start" onClick={() => onRestore(draft.id)} type="button" variant="ghost">
            <span className="min-w-0 flex-1 overflow-hidden">
              <span className="block truncate text-body-small text-foreground">{summary}</span>
              <span className="mt-px flex min-w-0 items-center gap-2 text-caption text-muted-foreground">
                <span className="truncate">{new Date(draft.updatedAt).toLocaleString(i18n.language)}</span>
                {draft.workingDraft === undefined ? null : <span className="shrink-0 text-brand">{t("composer.draftHasChanges")}</span>}
              </span>
            </span>
          </Button>
          <Button aria-label={t("composer.deleteDraft", { summary })} className="mr-1 shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100" onClick={() => onDelete(draft.id)} size="icon-sm" type="button" variant="ghost"><Trash2 aria-hidden="true" className="size-3.5" /></Button>
        </div>;
      })}
    </div>
  </PopoverContent>;
}
