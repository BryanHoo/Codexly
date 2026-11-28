import { agentEngineName } from "@codexly/protocol";
import type { AcpPlanPage } from "@codexly/protocol/acp-plan-api";
import { Clock3, Ellipsis, History, Trash2 } from "lucide-react";
import { Button } from "./button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu.js";
import type { PlanLabels } from "./acp-plan-contract.js";

export function AcpPlanListRow({
  row,
  selected,
  disabled,
  projectName,
  language,
  labels,
  onEdit,
  onHistory,
  onRemove,
}: Readonly<{
  row: AcpPlanPage["data"][number];
  selected: boolean;
  disabled: boolean;
  projectName: string;
  language: string | undefined;
  labels: PlanLabels;
  onEdit: () => void;
  onHistory: () => void;
  onRemove: () => void;
}>) {
  const status = row.enabled
    ? row.nextRunAt === null
      ? labels.ended
      : new Date(row.nextRunAt).toLocaleString(language)
    : labels.inactive;
  return (
    <div
      className="scheduled-task-row"
      data-active={selected || undefined}
      data-tone={row.enabled ? "scheduled" : "paused"}
    >
      <span className="scheduled-task-row__rail" aria-hidden="true" />
      <button
        type="button"
        aria-current={selected || undefined}
        aria-label={row.name}
        disabled={disabled}
        className="scheduled-task-row__content"
        onClick={onEdit}
      >
        <strong>{row.name}</strong>
        <span>
          {projectName} · {agentEngineName(row.engine)}
        </span>
        <span className="scheduled-task-row__time">
          <Clock3 aria-hidden="true" />
          {status}
        </span>
      </button>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label={`${labels.actions} · ${row.name}`}
            className="scheduled-task-row__menu"
            size="icon-toolbar"
            variant="ghost"
            disabled={disabled}
          >
            <Ellipsis aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="scheduled-task-menu">
          <DropdownMenuItem onSelect={onHistory}>
            <History aria-hidden="true" />
            {labels.history}
          </DropdownMenuItem>
          <DropdownMenuItem className="text-danger" onSelect={onRemove}>
            <Trash2 aria-hidden="true" />
            {labels.remove}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
