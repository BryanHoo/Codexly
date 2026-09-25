import type { ScheduledTask } from "@/protocol/index.js";
import "../../i18n/scheduled-recurrence.js";
import { CalendarClock, CircleAlert, Clock3, Plus, Search } from "lucide-react";
import { ScheduledTaskMenu } from "./scheduled-task-menu.js";
import { useMemo, useState } from "react";

import { useTranslation } from "../../i18n/i18n.js";
import { Button } from "../../shared/components/core/button.js";
import { Input } from "../../shared/components/core/input.js";
import { formatScheduledTime, scheduleToDraft, scheduledTaskEnded } from "./scheduled-task-schedule.js";

function statusTone(task: ScheduledTask): "failed" | "paused" | "running" | "scheduled" {
  if (!task.enabled) return "paused";
  if (task.lastRunStatus === "failed") return "failed";
  if (task.lastRunStatus === "running") return "running";
  return "scheduled";
}

export function ScheduledTaskList({
  activeId,
  loading,
  onCreate,
  onDelete,
  onEnabledChange,
  onSelect,
  query,
  setQuery,
  tasks,
}: Readonly<{
  activeId?: string;
  loading: boolean;
  onCreate: () => void;
  onDelete: (id: string) => void | Promise<unknown>;
  onEnabledChange: (id: string, enabled: boolean) => void;
  onSelect: (task: ScheduledTask) => void;
  query: string;
  setQuery: (query: string) => void;
  tasks: readonly ScheduledTask[];
}>) {
  const { i18n, t } = useTranslation("workbench");
  const [filter, setFilter] = useState<"all" | "enabled" | "disabled">("all");
  // 列表搜索与状态切换复用已有规则摘要，不为每次重绘重新解析时区与规则。
  const presets = useMemo(() => new Map(tasks.map((task) => [task.id, scheduleToDraft(task.schedule).preset])), [tasks]);
  // 筛选只作用于列表，保留右侧编辑草稿；后端未提供完成态，不推断执行结果。
  const filteredTasks = tasks.filter((task) => filter === "all" || task.enabled === (filter === "enabled"));
  return (
    <aside className="scheduled-task-list">
      <div className="scheduled-task-list__header">
        <div>
          <h2>{t("scheduledTasks.title")}</h2>
          <span>{tasks.length}</span>
        </div>
        <Button
          aria-label={t("scheduledTasks.create")}
          onClick={onCreate}
          size="icon-toolbar"
          type="button"
        >
          <Plus aria-hidden="true" />
        </Button>
      </div>
      <div className="scheduled-task-filters" role="group" aria-label={t("scheduledTasks.filter")}>
        {(["all", "enabled", "disabled"] as const).map((value) => (
          <button aria-pressed={filter === value} key={value} onClick={() => setFilter(value)} type="button">
            {t(`scheduledTasks.${value}`)}
          </button>
        ))}
      </div>
      <div className="scheduled-task-search">
        <Search aria-hidden="true" />
        <Input
          aria-label={t("scheduledTasks.search")}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder={t("scheduledTasks.search")}
          type="search"
          value={query}
        />
      </div>
      <div className="scheduled-task-list__items">
        {loading ? (
          <div className="scheduled-task-list__empty" role="status">
            <Clock3 aria-hidden="true" />
          </div>
        ) : filteredTasks.length === 0 ? (
          <div className="scheduled-task-list__empty">
            <CalendarClock aria-hidden="true" />
            <span>{t(tasks.length === 0 && query === "" ? "scheduledTasks.empty" : "scheduledTasks.noMatches")}</span>
          </div>
        ) : (
          filteredTasks.map((task) => {
            const tone = statusTone(task);
            return (
              <div
                className="scheduled-task-row"
                data-active={activeId === task.id ? "true" : undefined}
                data-tone={tone}
                key={task.id}
              >
                <span className="scheduled-task-row__rail" />
                <button
                  aria-current={activeId === task.id ? "page" : undefined}
                  aria-label={task.name}
                  className="scheduled-task-row__content"
                  onClick={() => onSelect(task)}
                  type="button"
                >
                  <strong>{task.name}</strong>
                  <span>{t(`scheduledTasks.${presets.get(task.id)!}`)} · {task.projectName}</span>
                  <span className="scheduled-task-row__time">
                    {tone === "failed" ? <CircleAlert aria-hidden="true" /> : <Clock3 aria-hidden="true" />}
                    {task.enabled
                      ? formatScheduledTime(task.nextRunAtUnixMs, i18n.resolvedLanguage)
                      : t(scheduledTaskEnded(task) ? "scheduledTasks.ended" : "scheduledTasks.disabled")}
                  </span>
                </button>
                <ScheduledTaskMenu task={task} onDelete={onDelete} onEnabledChange={onEnabledChange} />
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
