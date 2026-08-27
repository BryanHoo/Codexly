import { TEMPORARY_TASK_SCOPE_ID } from "@codexly/protocol";
import { Archive, MessageSquareText, Plus } from "lucide-react";

import { useTranslation } from "../../../i18n/i18n.js";
import { Button } from "../../../shared/components/core/button.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../shared/components/core/tooltip.js";
import type { ArchivedTaskScope } from "./archived-tasks-dialog.js";

type TemporaryTasksHeadingProps = Readonly<{
  expanded: boolean;
  onCreate: () => void;
  onOpenArchived: (scope: ArchivedTaskScope) => void;
  onToggle: () => void;
}>;

export function TemporaryTasksHeading({
  expanded,
  onCreate,
  onOpenArchived,
  onToggle,
}: TemporaryTasksHeadingProps) {
  const { t } = useTranslation("workbench");
  const temporaryTasksName = t("sidebar.temporaryTasks");
  const hoverActionClassName =
    "opacity-0 transition-[color,background-color,opacity] focus-visible:opacity-100 group-hover/temporary:opacity-100";

  return (
    <div className="group/temporary flex h-8 items-center gap-0.5 text-muted-foreground">
      <Button
        aria-controls="temporary-tasks-content"
        aria-expanded={expanded}
        className="h-8 min-w-0 flex-1 gap-2 rounded-control px-2 text-body-small font-medium"
        contentAlign="start"
        id="temporary-tasks-title"
        onClick={onToggle}
        type="button"
        variant="ghost"
      >
        <MessageSquareText className="size-4 shrink-0" aria-hidden="true" />
        <span className="truncate">{temporaryTasksName}</span>
      </Button>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            aria-label={t("sidebar.archived")}
            className={hoverActionClassName}
            id={`project-actions-${TEMPORARY_TASK_SCOPE_ID}`}
            onClick={() => {
              onOpenArchived({ id: TEMPORARY_TASK_SCOPE_ID, name: temporaryTasksName });
            }}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <Archive className="size-3.5" aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("sidebar.archived")}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            aria-label={t("sidebar.newTask")}
            className={hoverActionClassName}
            onClick={onCreate}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <Plus className="size-3.5" aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("sidebar.newTask")}</TooltipContent>
      </Tooltip>
    </div>
  );
}
