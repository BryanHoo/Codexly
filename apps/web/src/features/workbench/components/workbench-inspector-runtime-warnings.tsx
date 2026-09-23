import { AlertTriangle, ChevronRight } from "lucide-react";
import { useStore } from "zustand";

import { i18n } from "../../../i18n/i18n.js";
import type { TaskStore } from "../../conversation/runtime/task-store.js";
import { InspectorSection } from "./workbench-inspector-sections.js";

export function RuntimeWarningsSection({ store }: Readonly<{ store: TaskStore }>) {
  const notices = useStore(store, (state) => state.notices);
  const warnings = notices.filter((notice) => notice.payload.code === "runtime_warning");
  if (warnings.length === 0) return null;

  return (
    <InspectorSection
      icon={<AlertTriangle aria-hidden="true" className="size-3.5" />}
      title={i18n.t("inspector.runtimeWarnings", { ns: "conversation" })}
    >
      <div className="space-y-1">
        {warnings.map((warning) => (
          <details
            className="group rounded-control px-2 py-1.5 open:bg-control"
            data-runtime-warning=""
            key={`${warning.sessionId}:${String(warning.sequence)}`}
          >
            <summary className="flex min-h-7 cursor-pointer list-none items-center gap-2 text-label text-foreground [&::-webkit-details-marker]:hidden">
              <ChevronRight
                aria-hidden="true"
                className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
              />
              <span className="min-w-0 flex-1 truncate">
                {warning.payload.message.split(/\r?\n/u)[0]}
              </span>
            </summary>
            <p className="break-words whitespace-pre-wrap pl-5 text-caption leading-5 text-muted-foreground">
              {warning.payload.message}
            </p>
          </details>
        ))}
      </div>
    </InspectorSection>
  );
}
