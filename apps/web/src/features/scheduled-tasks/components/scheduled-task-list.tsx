import type { ScheduledTask } from "@codexly/protocol";
import { CalendarClock, CircleAlert, Clock3, Plus, Search } from "lucide-react";
import { Switch } from "radix-ui";

import { useTranslation } from "../../../i18n/i18n.js";
import { Button } from "../../../shared/components/core/button.js";
import { Input } from "../../../shared/components/core/input.js";
import { formatScheduledTime } from "../scheduled-task-schedule.js";

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
  onEnabledChange,
  onSelect,
  query,
  setQuery,
  tasks,
}: Readonly<{
  activeId?: string;
  loading: boolean;
  onCreate: () => void;
  onEnabledChange: (id: string, enabled: boolean) => void;
  onSelect: (task: ScheduledTask) => void;
  query: string;
  setQuery: (query: string) => void;
  tasks: readonly ScheduledTask[];
}>) {
  const { i18n, t } = useTranslation("workbench");
  return (
    <aside className="scheduled-task-list">
      <div className="scheduled-task-list-header">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 className="text-body-small font-semibold">{t("scheduledTasks.title")}</h2>
          <span className="text-caption text-subtle-foreground">{tasks.length}</span>
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
      <div className="relative mx-3 mb-2.5">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-2.5 top-2 size-3.5 text-subtle-foreground"
        />
        <Input
          aria-label={t("scheduledTasks.search")}
          className="h-8 pl-8"
          onChange={(event) => {
            setQuery(event.currentTarget.value);
          }}
          placeholder={t("scheduledTasks.search")}
          type="search"
          value={query}
        />
      </div>
      <div className="min-h-0 overflow-y-auto px-2 pb-3 [scrollbar-gutter:stable]">
        {loading ? (
          <div className="scheduled-task-empty" role="status">
            <Clock3 aria-hidden="true" />
          </div>
        ) : tasks.length === 0 ? (
          <div className="scheduled-task-empty">
            <CalendarClock aria-hidden="true" />
            <span>{t("scheduledTasks.empty")}</span>
          </div>
        ) : (
          tasks.map((task) => {
            const tone = statusTone(task);
            return (
              <div
                className="scheduled-task-row"
                data-active={activeId === task.id || undefined}
                data-tone={tone}
                key={task.id}
              >
                <span className="scheduled-task-rail" />
                <button
                  aria-current={activeId === task.id ? "page" : undefined}
                  aria-label={task.name}
                  className="scheduled-task-row-content"
                  onClick={() => {
                    onSelect(task);
                  }}
                  type="button"
                >
                  <strong>{task.name}</strong>
                  <span>{task.projectName}</span>
                  <span className="flex items-center gap-1.5">
                    {tone === "failed" ? (
                      <CircleAlert aria-hidden="true" className="size-3" />
                    ) : (
                      <Clock3 aria-hidden="true" className="size-3" />
                    )}
                    {task.enabled
                      ? formatScheduledTime(task.nextRunAtUnixMs, i18n.resolvedLanguage)
                      : t("scheduledTasks.disabled")}
                  </span>
                </button>
                <Switch.Root
                  aria-label={t(
                    task.enabled ? "scheduledTasks.disableTask" : "scheduledTasks.enableTask",
                    { name: task.name },
                  )}
                  checked={task.enabled}
                  className="scheduled-task-switch"
                  onCheckedChange={(enabled) => {
                    onEnabledChange(task.id, enabled);
                  }}
                >
                  <Switch.Thumb className="scheduled-task-switch-thumb" />
                </Switch.Root>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
