import { Info } from "lucide-react";
import { i18n } from "../../../i18n/i18n.js";
import type { TaskNotice } from "../../conversation/runtime/task-store.js";

export function getTimelineNotices(notices: readonly TaskNotice[]): readonly TaskNotice[] {
  return notices.filter(
    (notice) => notice.payload.level !== "warning" && notice.payload.code !== "runtime_warning",
  );
}

export function StoreTaskInfoNotices({ notices }: Readonly<{ notices: readonly TaskNotice[] }>) {
  return notices.map((notice) => (
    <div
      className="flex items-start gap-2 border-l-2 border-separator-strong px-3 py-2 text-label leading-5 text-muted-foreground"
      key={`${notice.sessionId}:${String(notice.sequence)}`}
      role="status"
    >
      <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      <div className="min-w-0">
        <p className="font-medium text-foreground">
          {i18n.t(`timeline.notice.${notice.payload.code}`, { ns: "conversation" })}
        </p>
        <p className="break-words">{notice.payload.message}</p>
      </div>
    </div>
  ));
}
