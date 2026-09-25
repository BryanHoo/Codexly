import { FilePenLine, FilePlus2 } from "lucide-react";
import { lazy, Suspense, useState } from "react";

import { useTranslation } from "../../../i18n/i18n.js";
import { PromptInputButton } from "../../../shared/components/agent/prompt-input.js";
import { Button } from "../../../shared/components/core/button.js";
import { Popover, PopoverTrigger } from "../../../shared/components/core/popover.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../shared/components/core/tooltip.js";
import type { ProjectDraftRecord } from "../project-draft-store.js";
const ProjectDraftListContent = lazy(() => import("./project-draft-list-content.js").then((module) => ({ default: module.ProjectDraftListContent })));
const ProjectDraftConfirm = lazy(() => import("./project-draft-confirm.js").then((module) => ({ default: module.ProjectDraftConfirm })));

export function ComposerDraftSaveButton({
  disabled,
  editing,
  onSave,
}: Readonly<{
  disabled: boolean;
  editing: boolean;
  onSave: () => void;
}>) {
  const { t } = useTranslation("workbench");
  const label = t(editing ? "composer.saveDraftChanges" : "composer.saveAsDraft");
  const DraftIcon = editing ? FilePenLine : FilePlus2;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <PromptInputButton aria-label={label} disabled={disabled} onClick={onSave}>
          <DraftIcon aria-hidden="true" className="size-3.5" />
        </PromptInputButton>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function ProjectDraftList({
  composerHasInput,
  drafts,
  onDelete,
  onRestore,
  projectName,
}: Readonly<{
  composerHasInput: boolean;
  drafts: readonly ProjectDraftRecord[];
  onDelete: (draftId: string) => void;
  onRestore: (draftId: string) => void;
  projectName: string;
}>) {
  const { t } = useTranslation("workbench");
  const [open, setOpen] = useState(false);
  const [pendingDraftId, setPendingDraftId] = useState<string>();
  const draftListLabel = t("composer.draftList", { project: projectName });
  if (drafts.length === 0) return null;
  const restoreDraft = (draftId: string) => {
    setOpen(false);
    if (composerHasInput) {
      setPendingDraftId(draftId);
      return;
    }
    onRestore(draftId);
  };
  return (
    <>
      <Popover onOpenChange={setOpen} open={open}>
        <PopoverTrigger asChild>
          <Button
            aria-label={t("composer.draftCount", { count: drafts.length })}
            className="h-6 px-1.5 text-caption"
            size="toolbar"
            type="button"
            variant="ghost"
          >
            {t("composer.draftCount", { count: drafts.length })}
          </Button>
        </PopoverTrigger>
        {open ? <Suspense fallback={null}><ProjectDraftListContent drafts={drafts} label={draftListLabel} onDelete={onDelete} onRestore={restoreDraft} /></Suspense> : null}
      </Popover>
      {pendingDraftId === undefined ? null : <Suspense fallback={null}><ProjectDraftConfirm onClose={() => setPendingDraftId(undefined)} onApply={() => { setPendingDraftId(undefined); onRestore(pendingDraftId); }} /></Suspense>}
    </>
  );
}
