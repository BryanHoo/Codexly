import { randomUUID } from "node:crypto";

import type { AgentProvider, AgentTaskScope } from "@codexly/core";

import { AgentEventStream, type AgentEventStreamOptions } from "./agent-event-stream.js";
import type { AttachmentStore } from "./attachment-store.js";
import { invalidateProjectGitBranchCache } from "./git-working-tree.js";
import type { ProjectRuntimeContext } from "./routes/context.js";

export function createProjectRuntimeContext(
  options: Readonly<{
    attachmentStore: AttachmentStore;
    eventBufferSize?: number;
    eventProvider: AgentEventStreamOptions["provider"];
    eventSessionId?: string;
    onActivity: () => void;
    onAttachmentReleaseError: (error: unknown) => void;
    onTurnCompleted?: (
      runtime: Readonly<{
        eventStream: AgentEventStream;
        projectId: string;
        provider: AgentProvider;
        taskId: string;
      }>,
    ) => Promise<void>;
    scope: AgentTaskScope;
    provider: AgentProvider;
  }>,
): ProjectRuntimeContext {
  const eventStream = new AgentEventStream({
    ...(options.eventBufferSize === undefined ? {} : { capacity: options.eventBufferSize }),
    provider: options.eventProvider,
    sessionId: options.eventSessionId ?? randomUUID(),
  });
  const { attachmentStore, onAttachmentReleaseError, provider, scope } = options;
  return {
    eventStream,
    provider,
    scope,
    transportMetrics: { activeClients: 0, slowClientDisconnects: 0 },
    unsubscribe: provider.subscribeEvents((event) => {
      options.onActivity();
      if (event.type === "turn.completed") {
        // Turn 终态到达后异步释放上传附件，不阻塞事件发布链路。
        void attachmentStore
          .releaseTurn(scope.id, event.payload.turn.id)
          .catch(onAttachmentReleaseError);
        // 权威持久队列在 Turn 终态后串行续发；编辑锁会让 startNext 保持等待。
        void options
          .onTurnCompleted?.({
            eventStream,
            projectId: scope.id,
            provider,
            taskId: event.taskId,
          })
          .catch(onAttachmentReleaseError);
      }
      if (event.type === "project.git_metadata_changed") {
        // 先失效分支候选，再让客户端读取一次完整 Git 状态。
        invalidateProjectGitBranchCache(event.payload.rootPath);
      }
      eventStream.publish(event);
    }),
  };
}
