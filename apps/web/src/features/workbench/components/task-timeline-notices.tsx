import { AlertTriangle, Info } from "lucide-react";
import { useStore } from "zustand";

import { i18n } from "../../../i18n/i18n.js";
import { Tool, ToolContent, ToolHeader } from "../../../shared/components/agent/tool.js";
import type { TaskNotice, TaskStore } from "../../conversation/runtime/task-store.js";

function TaskNoticeRow({ notice }: Readonly<{ notice: TaskNotice }>) {
  if (notice.payload.code === "runtime_warning") {
    const title = i18n.t("timeline.notice.runtime_warning", { ns: "conversation" });
    const firstLine = notice.payload.message.split(/\r?\n/u)[0]?.trim();
    return (
      <Tool data-runtime-warning="">
        <ToolHeader
          icon={<AlertTriangle aria-hidden="true" className="size-3.5 shrink-0 text-warning" />}
          title={firstLine ? `${title}: ${firstLine}` : title}
        />
        {/* 与工具输出一致，展开时才挂载完整警告，避免长日志拖长流式列表。 */}
        <ToolContent className="break-words whitespace-pre-wrap text-label leading-5 text-foreground">
          {notice.payload.message}
        </ToolContent>
      </Tool>
    );
  }
  const isWarning = notice.payload.level === "warning";
  const message =
    notice.payload.code === "model_verification"
      ? i18n.t("timeline.notice.modelVerification", { ns: "conversation" })
      : notice.payload.code === "strict_review_required"
        ? i18n.t("timeline.notice.strictReviewRequired", { ns: "conversation" })
        : notice.payload.message;
  const title = i18n.t(`timeline.notice.${notice.payload.code}`, { ns: "conversation" });

  return (
    <div
      className={`flex items-start gap-2 border-l-2 px-3 py-2 text-label leading-5 ${
        isWarning ? "border-warning text-warning" : "border-separator-strong text-muted-foreground"
      }`}
      role={isWarning ? "alert" : "status"}
    >
      {isWarning ? (
        <AlertTriangle aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      ) : (
        <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      )}
      <div className="min-w-0">
        <p className="font-medium text-foreground">{title}</p>
        <p className="break-words">{message}</p>
      </div>
    </div>
  );
}

export function StoreTaskNoticeList({ store }: Readonly<{ store: TaskStore }>) {
  const notices = useStore(store, (state) => state.notices);
  return notices.map((notice) => (
    <TaskNoticeRow key={`${notice.sessionId}:${String(notice.sequence)}`} notice={notice} />
  ));
}
