import { useState } from "react";
import { Trash2 } from "lucide-react";
import {
  getArchivedTaskDeletionDate,
  parseArchivedTaskDeletionDate,
} from "@codexly/frontend-core/archived-task-deletion";
import { Button } from "./button.js";

type DeleteRange = "all" | "1" | "3" | "6" | "12" | "custom";

export function ArchivedTaskDeleteControl({
  disabled,
  labels,
  onDelete,
}: Readonly<{
  disabled: boolean;
  labels: Readonly<{
    range: string;
    all: string;
    month: string;
    threeMonths: string;
    sixMonths: string;
    year: string;
    custom: string;
    date: string;
    deleteAll: string;
    deleteBefore: string;
    hint: string;
  }>;
  onDelete: (updatedBefore?: string) => void;
}>) {
  const [range, setRange] = useState<DeleteRange>("all");
  const [customDate, setCustomDate] = useState("");
  const selectedDate =
    range === "all" || range === "custom"
      ? customDate
      : getArchivedTaskDeletionDate(Number(range) as 1 | 3 | 6 | 12);
  const cutoff = range === "all" ? null : parseArchivedTaskDeletionDate(selectedDate);
  const inputClass =
    "h-9 min-w-0 rounded-control border border-separator-strong bg-panel px-2 text-body-small text-foreground outline-none focus-visible:shadow-focus disabled:opacity-50";

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <select
        aria-label={labels.range}
        className={inputClass}
        disabled={disabled}
        onChange={(event) => {
          setRange(event.currentTarget.value as DeleteRange);
        }}
        value={range}
      >
        <option value="all">{labels.all}</option>
        <option value="1">{labels.month}</option>
        <option value="3">{labels.threeMonths}</option>
        <option value="6">{labels.sixMonths}</option>
        <option value="12">{labels.year}</option>
        <option value="custom">{labels.custom}</option>
      </select>
      {range === "custom" ? (
        <input
          aria-label={labels.date}
          className={`${inputClass} max-w-40`}
          disabled={disabled}
          onChange={(event) => {
            setCustomDate(event.currentTarget.value);
          }}
          type="date"
          value={customDate}
        />
      ) : null}
      <Button
        className="min-h-9 text-danger hover:text-danger"
        disabled={disabled || (range !== "all" && cutoff === null)}
        onClick={() => {
          // 仅显式选择“全部”允许空筛选；自定义日期为空或无效时绝不能退化为全部删除。
          if (range === "all") onDelete();
          else if (cutoff !== null) onDelete(cutoff);
        }}
        size="sm"
        type="button"
        variant="ghost"
      >
        <Trash2 aria-hidden="true" />
        {range === "all" ? labels.deleteAll : labels.deleteBefore}
      </Button>
      {range === "all" ? null : (
        <p className="w-full text-caption text-muted-foreground">{labels.hint}</p>
      )}
    </div>
  );
}
