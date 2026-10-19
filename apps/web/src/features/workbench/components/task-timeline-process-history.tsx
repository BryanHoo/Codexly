import type { TurnProcessingTiming } from "@codexly/frontend-core/turn-processing-time";
import { HistoryProcess } from "@codexly/ui/core/history-process";
import type { AgentTaskSnapshotResponse } from "@codexly/protocol";
import { useCallback, useState } from "react";
import { useStore } from "zustand";
import { Message } from "../../../shared/components/agent/message.js";
import { TurnProcessingTime } from "./task-timeline-status.js";
import { i18n } from "../../../i18n/i18n.js";
import { useProjectData } from "../../projects/project-context-state.js";
import { createTaskStore, type TaskStore } from "../../conversation/runtime/task-store.js";
import { StoredAssistantTimelineItems } from "./task-timeline-store-operation-groups.js";
import type { MessageFileReference } from "../../../shared/components/agent/message.js";
import type { AgentFileChange } from "../../diff/file-change.js";

export function TurnProcessHistory({
  expanded,
  initialCursor,
  projectId,
  taskId,
  turnId,
  onOpenFileDiff,
  onOpenSourceFile,
}: Readonly<{
  expanded: boolean;
  initialCursor: string;
  projectId: string;
  taskId: string;
  turnId: string;
  onOpenFileDiff: (change: AgentFileChange) => void;
  onOpenSourceFile: (reference: MessageFileReference) => void;
}>) {
  const { client } = useProjectData();
  // 过程使用独立 Store，既不改动顶部历史游标，也不重排摘要中的问题和答复。
  const [store] = useState(() => createTaskStore({ projectId, taskId }));
  const readPage = useCallback(
    async (cursor: string) => {
      const page = await client.readTask(projectId, taskId, { cursor });
      if (
        page.snapshot.id !== taskId ||
        page.snapshot.projectId !== projectId ||
        page.snapshot.turns.some((turn) => turn.id !== turnId)
      )
        throw new Error("Process page identity mismatch");
      return { page, nextCursor: page.snapshot.turnsNextCursor };
    },
    [client, projectId, taskId, turnId],
  );
  const onPage = useCallback(
    (page: AgentTaskSnapshotResponse) => {
      store.getState().prependHistory(page);
    },
    [store],
  );
  return (
    <HistoryProcess
      expanded={expanded}
      initialCursor={initialCursor}
      readPage={readPage}
      onPage={onPage}
      labels={{
        loading: i18n.t("timeline.loadingProcess", { ns: "conversation" }),
        more: i18n.t("timeline.loadMoreProcess", { ns: "conversation" }),
        retry: i18n.t("timeline.retryProcess", { ns: "conversation" }),
      }}
    >
      <ProcessItems
        store={store}
        projectId={projectId}
        taskId={taskId}
        turnId={turnId}
        onOpenFileDiff={onOpenFileDiff}
        onOpenSourceFile={onOpenSourceFile}
      />
    </HistoryProcess>
  );
}

function ProcessItems({
  store,
  projectId,
  taskId,
  turnId,
  onOpenFileDiff,
  onOpenSourceFile,
}: Readonly<{
  store: TaskStore;
  projectId: string;
  taskId: string;
  turnId: string;
  onOpenFileDiff: (change: AgentFileChange) => void;
  onOpenSourceFile: (reference: MessageFileReference) => void;
}>) {
  const keys = useStore(store, (state) => state.itemKeysByTurnId[turnId]);
  const turn = useStore(store, (state) => state.turnsById[turnId]);
  const items = store.getState().itemStoresByKey;
  // 摘要已展示用户输入与最终答复，过程区只显示内部执行记录和旁白。
  const itemKeys = (keys ?? []).filter((key) => {
    const item = items.get(key)?.peek();
    return (
      item !== undefined &&
      item.type !== "review" &&
      (item.type !== "message" || (item.role === "assistant" && item.phase === "commentary"))
    );
  });
  return (
    <StoredAssistantTimelineItems
      itemKeys={itemKeys}
      itemTimings={turn?.itemTimings}
      lastTurnItemKey={keys?.at(-1)}
      onOpenFileDiff={onOpenFileDiff}
      onOpenSourceFile={onOpenSourceFile}
      projectId={projectId}
      taskId={taskId}
      store={store}
      turnStatus="completed"
    />
  );
}

export function EmptyTurnProcessHistory(
  props: Parameters<typeof TurnProcessHistory>[0] &
    TurnProcessingTiming &
    Readonly<{ onToggle: () => void }>,
) {
  return (
    <Message from="assistant">
      <TurnProcessingTime
        status={props.status}
        startedAt={props.startedAt}
        completedAt={props.completedAt}
        expanded={props.expanded}
        onToggle={props.onToggle}
      />
      <TurnProcessHistory {...props} />
    </Message>
  );
}
