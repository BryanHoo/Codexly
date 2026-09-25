import type { TaskNotice, TaskStore } from "../../conversation/runtime/task-store.js";
import { AlertTriangle, ChevronRight } from "lucide-react";
import { useStore } from "zustand";

import { i18n } from "../../../i18n/i18n.js";
import { WorkbenchInspectorIncrementalList } from "./workbench-inspector-incremental-list.js";
import { InspectorSection } from "./workbench-inspector-sections.js";

function RuntimeWarningRow({ notice }: Readonly<{ notice: TaskNotice }>) {
  const title = i18n.t(`timeline.notice.${notice.payload.code}`, { ns: "conversation" });
  return (
    <details className="group rounded-control px-2 hover:bg-control-hover">
      <summary className="flex min-h-8 cursor-pointer list-none items-center gap-2 text-label text-foreground focus-visible:shadow-focus focus-visible:outline-none [&::-webkit-details-marker]:hidden">
        <AlertTriangle aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">{title}: {notice.payload.message}</span>
        <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
      </summary>
      <p className="whitespace-pre-wrap break-words px-5 pb-2 text-caption leading-5 text-muted-foreground">
        {notice.payload.message}
      </p>
    </details>
  );
}

export function RuntimeWarningsSection({ notices }: Readonly<{ notices: readonly TaskNotice[] }>) {
  const warnings = notices.filter((notice) => notice.payload.level === "warning");
  if (warnings.length === 0) return null;

  return (
    <InspectorSection
      icon={<AlertTriangle className="size-3.5" />}
      title={i18n.t("inspector.runtimeWarnings", { ns: "conversation" })}
    >
      <WorkbenchInspectorIncrementalList
        ariaLabel={i18n.t("inspector.runtimeWarnings", { ns: "conversation" })}
        getKey={(notice) => `${notice.sessionId}:${String(notice.sequence)}`}
        items={warnings}
        renderItem={(notice) => <RuntimeWarningRow notice={notice} />}
      />
    </InspectorSection>
  );
}

export function StoreRuntimeWarningsSection({ store }: Readonly<{ store: TaskStore }>) {
  const notices = useStore(store, (state) => state.notices);
  return <RuntimeWarningsSection notices={notices} />;
}
