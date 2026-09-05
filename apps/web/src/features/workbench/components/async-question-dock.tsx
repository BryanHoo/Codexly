import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  MessageCircleQuestion,
} from "lucide-react";
import { useId, useMemo, useState, useSyncExternalStore } from "react";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";

import { useTranslation } from "../../../i18n/i18n.js";
import { Button } from "../../../shared/components/core/button.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../shared/components/core/tooltip.js";
import type { TaskStore } from "../../conversation/runtime/task-store-core.js";
import { createAsyncQuestionProjection, type QuestionEntry } from "./async-question-projection.js";
import { useAsyncQuestionSession } from "./async-question-session.js";
import { AsyncQuestions } from "./async-questions.js";

export function AsyncQuestionDock({ taskStore }: Readonly<{ taskStore: TaskStore | undefined }>) {
  const session = useAsyncQuestionSession();
  const projection = useMemo(() => createAsyncQuestionProjection(taskStore), [taskStore]);
  const entries = useSyncExternalStore(projection.subscribe, projection.getSnapshot);
  return session === null ? null : <QuestionDockContent entries={entries} session={session} />;
}

function QuestionDockContent({
  entries,
  session,
}: Readonly<{
  entries: readonly QuestionEntry[];
  session: NonNullable<ReturnType<typeof useAsyncQuestionSession>>;
}>) {
  const { t } = useTranslation("conversation");
  const pending = useStore(
    session.store,
    useShallow((state) =>
      entries.filter((entry) => state.drafts.get(entry.item.id)?.status !== "sent"),
    ),
  );
  const [selectedKey, setSelectedKey] = useState<string>();
  const [collapsed, setCollapsed] = useState(false);
  const contentId = useId();
  const selectedIndex = Math.max(
    0,
    pending.findIndex((entry) => entry.key === selectedKey),
  );
  const selected = pending[selectedIndex];
  if (selected === undefined) return null;

  return (
    <section
      aria-label={t("asyncQuestions.pending")}
      className="shrink-0 min-w-0 bg-content px-5 pb-2"
    >
      <div className="flex min-w-0 items-center gap-2 border-t border-separator pt-2 pb-1">
        <MessageCircleQuestion aria-hidden="true" className="size-3.5 shrink-0 text-brand" />
        <span className="min-w-0 flex-1 truncate text-label font-medium">
          {t("asyncQuestions.pendingCount", { count: pending.length })}
        </span>
        {pending.length < 2 ? null : (
          <>
            <DockButton
              label={t("asyncQuestions.previous")}
              disabled={selectedIndex === 0}
              onClick={() => {
                setSelectedKey(pending[selectedIndex - 1]?.key);
              }}
            >
              <ChevronLeft className="size-3.5" />
            </DockButton>
            <span className="min-w-12 text-center text-caption tabular-nums">
              {selectedIndex + 1}/{pending.length}
            </span>
            <DockButton
              label={t("asyncQuestions.next")}
              disabled={selectedIndex === pending.length - 1}
              onClick={() => {
                setSelectedKey(pending[selectedIndex + 1]?.key);
              }}
            >
              <ChevronRight className="size-3.5" />
            </DockButton>
          </>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-controls={contentId}
              aria-expanded={!collapsed}
              aria-label={t(collapsed ? "asyncQuestions.expand" : "asyncQuestions.collapse")}
              onClick={() => {
                setCollapsed((value) => !value);
              }}
            >
              {collapsed ? (
                <ChevronUp className="size-3.5" />
              ) : (
                <ChevronDown className="size-3.5" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {t(collapsed ? "asyncQuestions.expand" : "asyncQuestions.collapse")}
          </TooltipContent>
        </Tooltip>
      </div>
      {/* 问答区独立滚动且限制高度，不改变时间线的虚拟滚动容器。 */}
      <div
        id={contentId}
        hidden={collapsed}
        className="max-h-[min(32vh,20rem)] overflow-y-auto overscroll-contain py-2"
      >
        <AsyncQuestions key={selected.key} item={selected.item} />
      </div>
    </section>
  );
}

function DockButton({
  label,
  disabled,
  onClick,
  children,
}: Readonly<{
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}>) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
