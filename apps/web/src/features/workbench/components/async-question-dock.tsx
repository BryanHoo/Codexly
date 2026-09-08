import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  MessageCircleQuestion,
  X,
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
import { readQuestionDismissals, saveQuestionDismissals } from "./async-question-dismissals.js";

export function AsyncQuestionDock({
  taskStore,
  scope,
}: Readonly<{ taskStore: TaskStore | undefined; scope: string }>) {
  const session = useAsyncQuestionSession();
  const projection = useMemo(() => createAsyncQuestionProjection(taskStore), [taskStore]);
  const entries = useSyncExternalStore(projection.subscribe, projection.getSnapshot);
  return session === null ? null : (
    <QuestionDockContent key={scope} entries={entries} session={session} scope={scope} />
  );
}

function QuestionDockContent({
  entries,
  session,
  scope,
}: Readonly<{
  entries: readonly QuestionEntry[];
  session: NonNullable<ReturnType<typeof useAsyncQuestionSession>>;
  scope: string;
}>) {
  const { t } = useTranslation("conversation");
  const [dismissed, setDismissed] = useState(() => readQuestionDismissals(scope));
  const pending = useStore(
    session.store,
    useShallow((state) =>
      entries.filter(
        (entry) => !dismissed.has(entry.key) && state.drafts.get(entry.item.id)?.status !== "sent",
      ),
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
      // 与引导消息共用输入框的宽度容器，问答区固定在输入框上方并独立滚动。
      className="mb-2 min-w-0 rounded-control border border-separator bg-control px-3 pb-2"
    >
      <div className="flex min-w-0 items-center gap-2 pt-2 pb-1">
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
        <DockButton
          label={t("asyncQuestions.close")}
          disabled={false}
          onClick={() => {
            // 按任务保存关闭标识，重开任务不再展示旧问题，新增问题不受影响。
            setDismissed(
              saveQuestionDismissals(
                scope,
                new Set([...dismissed, ...entries.map((entry) => entry.key)]),
              ),
            );
            setCollapsed(false);
          }}
        >
          <X className="size-3.5" />
        </DockButton>
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
