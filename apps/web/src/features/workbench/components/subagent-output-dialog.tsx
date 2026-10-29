import { useRef } from "react";
import {
  SubagentContent as SharedSubagentContent,
  SubagentThreadContent as SharedSubagentThreadContent,
} from "@codexly/ui/agent/subagent";
import { OperationDetailsDialogContent } from "@codexly/ui/agent/tool-details";
import { useStore } from "zustand";
import { TimelineItemContent } from "./task-timeline-items.js";
import { StoredTimelineItemContent } from "./task-timeline-store-items.js";
import type { TaskStore, TaskItemStore } from "../../conversation/runtime/task-store.js";
import type { ProjectRuntimeManager } from "../../conversation/runtime/project-runtime.js";
import {
  useTaskRuntime,
  type TaskRuntimeView,
} from "../../conversation/runtime/use-task-runtime.js";
import { withAgentLocale } from "../../../shared/components/agent/with-agent-locale.js";
import { Dialog } from "../../../shared/components/core/dialog.js";
import { parseSubagentOperation, type SubagentSelection } from "./subagent.js";
import { i18n, useTranslation } from "../../../i18n/i18n.js";
import { TaskTimelinePagination } from "./task-timeline-pagination.js";
import { TurnProcessHistory } from "./task-timeline-lazy-process.js";
import { TimelineImageProvider } from "./timeline-image-provider.js";

const SubagentContent = /* @__PURE__ */ withAgentLocale(SharedSubagentContent);
const SubagentThreadContent = /* @__PURE__ */ withAgentLocale(SharedSubagentThreadContent);
const ignoreFile = () => undefined;
type SubagentOutputDialogProps = Readonly<{
  onClose: () => void;
  projectId: string;
  projectRuntime: ProjectRuntimeManager;
  selection: SubagentSelection | null;
}>;

function SubagentOutputState({ message, role }: { message: string; role?: "alert" | "status" }) {
  return (
    <div
      className="grid min-h-24 place-items-center text-body-small text-muted-foreground"
      role={role}
    >
      {message}
    </div>
  );
}

export function SubagentOutputDialog(props: SubagentOutputDialogProps) {
  if (props.selection === null) return null;
  // 切换入口目标时重置分页和跟随身份，旧订阅随弹窗卸载，不沿用另一任务的阅读位置。
  return (
    <OpenSubagentOutputDialog
      {...props}
      selection={props.selection}
      key={`${props.projectId}:${props.selection.taskId}:${props.selection.embedded?.itemId ?? ""}`}
    />
  );
}

function OpenSubagentOutputDialog({
  onClose,
  projectId,
  projectRuntime,
  selection,
}: Omit<SubagentOutputDialogProps, "selection"> & { selection: SubagentSelection }) {
  const { t } = useTranslation("workbench");
  // 右栏入口位于 Dialog 外，显式保存打开按钮；关闭后恢复键盘阅读位置。
  const returnFocus = useRef(
    typeof document !== "undefined" && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  const runtime = useTaskRuntime(
    projectId,
    selection.embedded?.parentTaskId ?? selection.taskId,
    projectRuntime,
  );
  let content;
  if (runtime.error !== null)
    content = <SubagentOutputState message={t("subagentOutput.error")} role="alert" />;
  else if (runtime.isPending || !runtime.metadata || !runtime.store)
    content = <SubagentOutputState message={t("subagentOutput.loading")} role="status" />;
  else
    content = selection.embedded ? (
      <EmbeddedTimeline
        store={runtime.store}
        itemId={selection.embedded.itemId}
        projectId={projectId}
        taskId={selection.embedded.parentTaskId}
      />
    ) : (
      <IndependentTimeline store={runtime.store} runtime={runtime} selection={selection} />
    );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <OperationDetailsDialogContent
        title={t("subagentOutput.title")}
        closeLabel={t("subagentOutput.close")}
        followOutput
        data-subagent-output-dialog=""
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true });
        }}
      >
        <TimelineImageProvider projectId={projectId} rootPath={runtime.metadata?.workspacePath}>
          {content}
        </TimelineImageProvider>
      </OperationDetailsDialogContent>
    </Dialog>
  );
}

function EmbeddedTimeline({
  store,
  itemId,
  projectId,
  taskId,
}: {
  store: TaskStore;
  itemId: string;
  projectId: string;
  taskId: string;
}) {
  const itemStore = useStore(store, (state) =>
    [...state.itemStoresByKey.values()].find((candidate) => candidate.peek().id === itemId),
  );
  return itemStore ? (
    <EmbeddedContent itemStore={itemStore} projectId={projectId} taskId={taskId} />
  ) : null;
}

function EmbeddedContent({
  itemStore,
  projectId,
  taskId,
}: {
  itemStore: TaskItemStore;
  projectId: string;
  taskId: string;
}) {
  // 只订阅当前父条目，Claude 内嵌输出继续使用现有事件链路，不创建子任务请求。
  useStore(itemStore, (state) => state.revision);
  const item = itemStore.read();
  if (item.type !== "tool") return null;
  const operation = parseSubagentOperation(item);
  if (!operation) return null;
  return (
    <SubagentContent
      item={item}
      agents={operation.agents}
      prompt={operation.prompt}
      model={operation.model}
      reasoningEffort={operation.reasoningEffort}
      loadOlderLabel={i18n.t("timeline.loadOlder", { ns: "conversation" })}
      renderItem={(nested, turn, index) => (
        <TimelineItemContent
          item={nested}
          itemTiming={turn.itemTimings?.[nested.id]}
          isLastTurnItem={index === turn.items.length - 1}
          turnStatus={turn.status}
          projectId={projectId}
          taskId={taskId}
          onOpenFileDiff={ignoreFile}
          onOpenSourceFile={ignoreFile}
        />
      )}
    />
  );
}

function IndependentTimeline({
  store,
  runtime,
  selection,
}: {
  store: TaskStore;
  runtime: TaskRuntimeView;
  selection: SubagentSelection;
}) {
  const { projectId, taskId } = store.getState();
  const firstKey = useStore(store, (state) => state.itemKeysByTurnId[state.turnIds[0] ?? ""]?.[0]);
  const firstItem = firstKey ? store.getState().itemStoresByKey.get(firstKey)?.peek() : undefined;
  const initialPrompt =
    firstKey &&
    firstItem?.type === "message" &&
    firstItem.role === "user" &&
    (firstItem.attachments?.length ?? 0) === 0 &&
    (firstItem.skills?.length ?? 0) === 0
      ? { entryId: firstKey, text: firstItem.text }
      : undefined;
  return (
    <SubagentThreadContent
      store={store}
      initialPrompt={initialPrompt}
      taskId={selection.taskId}
      status={selection.status}
      olderHistory={
        runtime.hasOlderHistory ? (
          <TaskTimelinePagination
            error={runtime.olderHistoryError}
            isLoading={runtime.isLoadingOlderHistory}
            onLoad={runtime.loadOlderHistory}
          />
        ) : null
      }
      renderProcess={(turn) =>
        turn.processCursor ? (
          <TurnProcessHistory
            expanded
            initialCursor={turn.processCursor}
            projectId={projectId}
            taskId={taskId}
            turnId={turn.id}
            onOpenFileDiff={ignoreFile}
            onOpenSourceFile={ignoreFile}
          />
        ) : null
      }
      renderItem={(entry, turn) => {
        const itemId = store.getState().itemStoresByKey.get(entry.id)?.peek().id;
        const itemTiming = itemId ? turn.itemTimings?.[itemId] : undefined;
        return (
          <StoredTimelineItemContent
            store={store}
            itemKey={entry.id}
            isLastTurnItem={entry.last}
            turnStatus={turn.status}
            {...(itemTiming ? { itemTiming } : {})}
            projectId={projectId}
            taskId={taskId}
            onOpenFileDiff={ignoreFile}
            onOpenSourceFile={ignoreFile}
          />
        );
      }}
    />
  );
}
