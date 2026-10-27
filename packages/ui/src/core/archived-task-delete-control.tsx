import { useState } from "react";
import { Trash2 } from "lucide-react";
import {
  getArchivedTaskDeletionDate,
  parseArchivedTaskDeletionDate,
} from "@codexly/frontend-core/archived-task-deletion";
import { Button } from "./button.js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select.js";

type DeleteRange = "all" | "1" | "3" | "6" | "12";

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
    deleteAll: string;
    deleteBefore: string;
  }>;
  onDelete: (updatedBefore?: string) => void;
}>) {
  const [range, setRange] = useState<DeleteRange>("all");
  // 固定范围统一按本地日期计算截止时间，具体日期与永久删除提醒仅在二次确认展示。
  const cutoff =
    range === "all"
      ? null
      : parseArchivedTaskDeletionDate(getArchivedTaskDeletionDate(Number(range) as 1 | 3 | 6 | 12));

  return (
    <div className="flex shrink-0 items-center gap-2">
      <Select
        disabled={disabled}
        onValueChange={(value) => {
          setRange(value as DeleteRange);
        }}
        value={range}
      >
        <SelectTrigger aria-label={labels.range}>
          <SelectValue />
        </SelectTrigger>
        {/* 通过通用组件的 Portal 弹出菜单，避免被单行底栏的滚动容器裁切。 */}
        <SelectContent align="start" position="popper">
          <SelectItem value="all">{labels.all}</SelectItem>
          <SelectItem value="1">{labels.month}</SelectItem>
          <SelectItem value="3">{labels.threeMonths}</SelectItem>
          <SelectItem value="6">{labels.sixMonths}</SelectItem>
          <SelectItem value="12">{labels.year}</SelectItem>
        </SelectContent>
      </Select>
      <Button
        className="min-h-9 shrink-0 text-danger hover:text-danger"
        disabled={disabled || (range !== "all" && cutoff === null)}
        onClick={() => {
          // 仅显式选择“全部”允许空筛选，截止日期无效时不能退化为全部删除。
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
    </div>
  );
}
