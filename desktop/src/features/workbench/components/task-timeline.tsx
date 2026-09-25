import { useHistoryLocation } from "../../search/history-location.js";
import type { PendingRequest, Project } from "@/protocol/index.js";
import { lazy, Suspense, useMemo } from "react";

import { i18n, useTranslation } from "../../../i18n/i18n.js";

import {
  Conversation,
  ConversationContent,
} from "../../../shared/components/agent/conversation.js";
import { Message, type MessageFileReference } from "../../../shared/components/agent/message.js";
import type { RuntimeTaskSnapshot } from "../../conversation/runtime/task-runtime.js";
import { createTaskStore } from "../../conversation/runtime/task-store.js";
import type { TaskRuntimeView } from "../../conversation/runtime/use-task-runtime.js";
import type { AgentFileChange } from "../../diff/file-change.js";
import type { PendingRequestResolution } from "./pending-request.js";
import type { ForkTaskAction } from "./task-timeline-contracts.js";

import { EmptyTimeline, TimelineState } from "./task-timeline-status.js";
import { TurnProcessingTime } from "./task-timeline-status.js";
import { RunningReplyStatus } from "./task-timeline-running.js";
import { TaskStoreTimeline } from "./task-timeline-store.js";

export { resolveMessageResponseRendering } from "./task-timeline-running.js";
export { resolveCompletedTurnProcessItemIds } from "./task-timeline-process.js";
const HistoryTaskTimeline = lazy(() => import("../../search/history-task-timeline.js").then((module) => ({ default: module.HistoryTaskTimeline })));
type BuildPlanAction = () => Promise<boolean>;

type TaskTimelineCommonProps = Readonly<{
  onBuildPlan?: BuildPlanAction;
  onForkTask?: ForkTaskAction;
  onOpenFileDiff?: (change: AgentFileChange) => void;
  onReviewFileChanges?: (changes: readonly AgentFileChange[]) => void;
  onOpenSourceFile?: (reference: MessageFileReference) => void;
  onResolvePendingRequest?: (
    request: PendingRequest,
    resolution: PendingRequestResolution,
    idempotencyKey: string,
  ) => Promise<void>;
  runtime?: TaskRuntimeView;
  scrollToBottomSignal?: number;
  submissionStartedAt?: string;
  submissionTurnId?: string;
  startingSnapshot?: RuntimeTaskSnapshot;
}>;

type TaskTimelineProps = TaskTimelineCommonProps &
  Readonly<
    | {
        onProjectChange: (projectId: string) => void;
        projectId: string;
        projects: readonly Project[];
        taskId?: undefined;
      }
    | {
        projectId: string;
        scopeName: string;
        taskId?: undefined;
        temporary: true;
      }
    | {
        taskId: string;
        projectId: string;
      }
  >;

const ignoreFileChange = () => undefined;
const ignoreSourceFile = () => undefined;
const ignoreFileChanges = () => undefined;
const ignorePendingRequest = () => Promise.resolve();
export function TaskTimeline(props: TaskTimelineProps) {
  useTranslation("conversation");
  const location = useHistoryLocation((state) => state.location?.projectId === props.projectId && state.location.taskId === props.taskId ? state.location : null);
  if (location !== null) {
    return <Suspense fallback={<TimelineState message={i18n.t("timeline.loading", { ns: "conversation" })} role="status" />}><HistoryTaskTimeline location={location}
      {...(props.onOpenFileDiff === undefined ? {} : { onOpenFileDiff: props.onOpenFileDiff })}
      {...(props.onOpenSourceFile === undefined ? {} : { onOpenSourceFile: props.onOpenSourceFile })}
      {...(props.onReviewFileChanges === undefined ? {} : { onReviewFileChanges: props.onReviewFileChanges })} /></Suspense>;
  }
  if (props.taskId === undefined) {
    if (props.submissionStartedAt !== undefined) {
      return (
        <Conversation
          aria-label={i18n.t("timeline.conversation", { ns: "conversation" })}
          conversationId={`${props.projectId}:new-chat`}
        >
          <ConversationContent className="gap-6">
            <Message from="assistant">
              <TurnProcessingTime completedAt={null} startedAt={props.submissionStartedAt} />
              <RunningReplyStatus />
            </Message>
          </ConversationContent>
        </Conversation>
      );
    }
    return "temporary" in props ? (
      <EmptyTimeline scopeName={props.scopeName} />
    ) : (
      <EmptyTimeline
        onProjectChange={props.onProjectChange}
        projectId={props.projectId}
        projects={props.projects}
      />
    );
  }
  const {
    onBuildPlan,
    onForkTask,
    onOpenFileDiff,
    onOpenSourceFile,
    onReviewFileChanges,
    onResolvePendingRequest,
    runtime,
    scrollToBottomSignal,
    submissionStartedAt,
    submissionTurnId,
    startingSnapshot,
  } = props;
  if (runtime === undefined) {
    return (
      <TimelineState message={i18n.t("timeline.loading", { ns: "conversation" })} role="status" />
    );
  }
  return (
    <ActiveTaskTimeline
      onOpenFileDiff={onOpenFileDiff ?? ignoreFileChange}
      onOpenSourceFile={onOpenSourceFile ?? ignoreSourceFile}
      onReviewFileChanges={onReviewFileChanges ?? ignoreFileChanges}
      onResolvePendingRequest={onResolvePendingRequest ?? ignorePendingRequest}
      {...(onBuildPlan === undefined ? {} : { onBuildPlan })}
      {...(onForkTask === undefined ? {} : { onForkTask })}
      runtime={runtime}
      scrollToBottomSignal={scrollToBottomSignal}
      submissionStartedAt={submissionStartedAt}
      submissionTurnId={submissionTurnId}
      startingSnapshot={startingSnapshot}
    />
  );
}

function ActiveTaskTimeline({
  onBuildPlan,
  onForkTask,
  onOpenFileDiff,
  onOpenSourceFile,
  onReviewFileChanges,
  onResolvePendingRequest,
  runtime,
  scrollToBottomSignal,
  submissionStartedAt,
  submissionTurnId,
  startingSnapshot,
}: Readonly<{
  onResolvePendingRequest: (
    request: PendingRequest,
    resolution: PendingRequestResolution,
    idempotencyKey: string,
  ) => Promise<void>;
  onOpenFileDiff: (change: AgentFileChange) => void;
  onForkTask?: ForkTaskAction;
  onOpenSourceFile: (reference: MessageFileReference) => void;
  onReviewFileChanges: (changes: readonly AgentFileChange[]) => void;
  onBuildPlan?: BuildPlanAction;
  runtime: TaskRuntimeView;
  scrollToBottomSignal: number | undefined;
  submissionStartedAt: string | undefined;
  submissionTurnId: string | undefined;
  startingSnapshot: RuntimeTaskSnapshot | undefined;
}>) {
  if (runtime.error !== null) {
    return (
      <TimelineState message={i18n.t("timeline.loadError", { ns: "conversation" })} role="alert" />
    );
  }
  if (runtime.isPending || runtime.metadata === undefined) {
    if (startingSnapshot !== undefined) {
      return <TaskSnapshotTimeline connected={false} snapshot={startingSnapshot} />;
    }
    return (
      <TimelineState message={i18n.t("timeline.loading", { ns: "conversation" })} role="status" />
    );
  }
  if (runtime.store === undefined) {
    return (
      <TimelineState message={i18n.t("timeline.loading", { ns: "conversation" })} role="status" />
    );
  }
  return (
    <>
      {runtime.connectionState === "reconnecting" ? (
        <div
          className="bg-control px-3 py-1.5 text-center text-label text-muted-foreground"
          role="status"
        >
          {i18n.t("timeline.reconnecting", { ns: "conversation" })}
        </div>
      ) : null}
      <TaskStoreTimeline
        // 等待任务写入权确认后再启用审批，确保 inert 解除时重新触发主操作聚焦。
        connected={runtime.connectionState === "connected"
          && (runtime.writeAccess === undefined || runtime.writeAccess === "writable")}
        hasOlderHistory={runtime.hasOlderHistory}
        isLoadingOlderHistory={runtime.isLoadingOlderHistory}
        olderHistoryError={runtime.olderHistoryError}
        {...(onBuildPlan === undefined ? {} : { onBuildPlan })}
        {...(onForkTask === undefined ? {} : { onForkTask })}
        onOpenFileDiff={onOpenFileDiff}
        onOpenSourceFile={onOpenSourceFile}
        onReviewFileChanges={onReviewFileChanges}
        onResolvePendingRequest={onResolvePendingRequest}
        onLoadOlderHistory={runtime.loadOlderHistory}
        {...(scrollToBottomSignal === undefined ? {} : { scrollToBottomSignal })}
        store={runtime.store}
        {...(submissionStartedAt === undefined ? {} : { submissionStartedAt })}
        {...(submissionTurnId === undefined ? {} : { submissionTurnId })}
      />
    </>
  );
}

export function TaskSnapshotTimeline({
  connected = true,
  onBuildPlan,
  onForkTask,
  onOpenFileDiff = () => undefined,
  onOpenSourceFile = () => undefined,
  onReviewFileChanges = () => undefined,
  onResolvePendingRequest = () => Promise.resolve(),
  snapshot,
}: Readonly<{
  connected?: boolean;
  onBuildPlan?: BuildPlanAction;
  onForkTask?: ForkTaskAction;
  onOpenFileDiff?: (change: AgentFileChange) => void;
  onOpenSourceFile?: (reference: MessageFileReference) => void;
  onReviewFileChanges?: (changes: readonly AgentFileChange[]) => void;
  onResolvePendingRequest?: (
    request: PendingRequest,
    resolution: PendingRequestResolution,
    idempotencyKey: string,
  ) => Promise<void>;
  snapshot: RuntimeTaskSnapshot;
}>) {
  useTranslation("conversation");
  const store = useMemo(
    // 启动快照也进入统一归一化边界，确保分组、容量限制和渲染行为与实时 Store 一致。
    () =>
      createTaskStore(
        { projectId: snapshot.projectId, taskId: snapshot.id },
        {
          checkpoint: { sequence: 0, sessionId: "starting-snapshot" },
          snapshot,
        },
      ),
    [snapshot],
  );
  return (
    <TaskStoreTimeline
      connected={connected}
      {...(onBuildPlan === undefined ? {} : { onBuildPlan })}
      {...(onForkTask === undefined ? {} : { onForkTask })}
      onOpenFileDiff={onOpenFileDiff}
      onOpenSourceFile={onOpenSourceFile}
      onReviewFileChanges={onReviewFileChanges}
      onResolvePendingRequest={onResolvePendingRequest}
      store={store}
    />
  );
}
