import { QuestionnaireCard } from "@codexly/ui/core/questionnaire";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, MessageCircleQuestion, X, type LucideIcon } from "lucide-react";
import { lazy, Suspense, useEffect, useId, useMemo, useState, useSyncExternalStore } from "react";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";

import { useTranslation } from "../../../i18n/i18n.js";
import { Button } from "../../../shared/components/core/button.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../shared/components/core/tooltip.js";
import type { TaskStore } from "../../conversation/runtime/task-store-core.js";
import { createAsyncQuestionProjection, type QuestionEntry } from "./async-question-projection.js";
import { resolveQuestionActivity, useAsyncQuestionSession } from "./async-question-session.js";

// 无待回答问题时不加载表单代码，降低工作台初始加载量。
const AsyncQuestions = lazy(() => import("./async-questions.js").then((module) => ({ default: module.AsyncQuestions })));

export function AsyncQuestionDock({ taskStore }: Readonly<{ taskStore: TaskStore | undefined }>) {
  const session = useAsyncQuestionSession();
  const projection = useMemo(() => createAsyncQuestionProjection(taskStore), [taskStore]);
  const entries = useSyncExternalStore(projection.subscribe, projection.getSnapshot);
  return session === null ? null : <QuestionDockContent entries={entries} session={session} />;
}

function QuestionDockContent({ entries, session }: Readonly<{
  entries: readonly QuestionEntry[];
  session: NonNullable<ReturnType<typeof useAsyncQuestionSession>>;
}>) {
  const { t } = useTranslation("conversation");
  const pending = useStore(session.store, useShallow((state) =>
    entries.filter((entry) => !isResolved(entry, state))));
  const resolved = useStore(session.store, useShallow((state) =>
    entries.filter((entry) => isResolved(entry, state)).map((entry) => entry.item.id)));
  // 历史恢复完成后批量校准原生状态，已关闭或已回答的问题不能因重启重新变成待处理。
  useEffect(() => resolveQuestionActivity(session.scope, resolved), [session.scope, resolved]);
  const [selectedKey, setSelectedKey] = useState<string>();
  const [collapsed, setCollapsed] = useState(false);
  const contentId = useId();
  const selectedIndex = Math.max(0, pending.findIndex((entry) => entry.key === selectedKey));
  const selected = pending[selectedIndex];
  if (selected === undefined) return null;

  return (
    <div className="shrink-0 min-w-0 bg-content px-1 pb-2 sm:px-5">
    <QuestionnaireCard aria-label={t("asyncQuestions.pending")} className="mx-auto max-w-content px-2.5 pb-1.5">
      <div className="flex min-w-0 items-center gap-1 pt-1.5 pb-0.5">
        <MessageCircleQuestion aria-hidden="true" className="size-3.5 shrink-0 text-brand" />
        <span className="min-w-0 flex-1 truncate text-label font-medium">
          {t("asyncQuestions.pendingCount", { count: pending.length })}
        </span>
        {pending.length < 2 ? null : (
          <>
            <DockButton icon={ChevronLeft} label={t("asyncQuestions.previous")} disabled={selectedIndex === 0}
              onClick={() => setSelectedKey(pending[selectedIndex - 1]!.key)} />
            <span className="min-w-8 text-center text-caption tabular-nums">{selectedIndex + 1}/{pending.length}</span>
            <DockButton icon={ChevronRight} label={t("asyncQuestions.next")} disabled={selectedIndex === pending.length - 1}
              onClick={() => setSelectedKey(pending[selectedIndex + 1]!.key)} />
          </>
        )}
        <DockButton icon={collapsed ? ChevronUp : ChevronDown} label={t(collapsed ? "asyncQuestions.expand" : "asyncQuestions.collapse")}
          controls={contentId} expanded={!collapsed} onClick={() => setCollapsed((value) => !value)} />
        <DockButton icon={X} label={t("asyncQuestions.dismiss")}
          onClick={() => session.store.getState().dismiss(selected.key, selected.item.id)} />
      </div>
      {/* 问答区独立滚动且限制高度，不改变时间线的虚拟滚动容器。 */}
      <div id={contentId} hidden={collapsed} className="py-0.5">
        <Suspense fallback={null}>
          <AsyncQuestions key={selected.key} questionId={selected.key} item={selected.item} />
        </Suspense>
      </div>
    </QuestionnaireCard>
    </div>
  );
}

function DockButton({ label, disabled, controls, expanded, onClick, icon: Icon }: Readonly<{
  label: string;
  disabled?: boolean;
  controls?: string;
  expanded?: boolean;
  onClick: () => void;
  icon: LucideIcon;
}>) {
  return <Tooltip>
    <TooltipTrigger asChild>
      <Button type="button" variant="ghost" size="icon-toolbar" aria-label={label} aria-controls={controls}
        aria-expanded={expanded} disabled={disabled} onClick={onClick}>
        <Icon className="size-3.5" />
      </Button>
    </TooltipTrigger>
    <TooltipContent>{label}</TooltipContent>
  </Tooltip>;
}

/** 兼容旧版按原生 ID 保存的关闭记录，新记录统一按稳定问题身份保存。 */
function isResolved(entry: QuestionEntry, state: { sentIds: ReadonlySet<string>; dismissedIds: ReadonlySet<string> }): boolean {
  return [entry.key, entry.item.id, ...(entry.item.identityAliases ?? [])].some((id) =>
    state.sentIds.has(id) || state.dismissedIds.has(id));
}
