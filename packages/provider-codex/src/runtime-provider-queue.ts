import type { AgentProviderQueue } from "@codexly/core";

export function createOwnedAgentProviderQueue(
  delegate: AgentProviderQueue,
  ensureTaskOwner: (taskId: string) => Promise<void>,
): AgentProviderQueue {
  return {
    add: async (taskId, input, clientUserMessageId) => {
      await ensureTaskOwner(taskId);
      return delegate.add(taskId, input, clientUserMessageId);
    },
    delete: async (taskId, queuedSubmissionId) => {
      await ensureTaskOwner(taskId);
      return delegate.delete(taskId, queuedSubmissionId);
    },
    list: async (taskId, input) => {
      await ensureTaskOwner(taskId);
      return delegate.list(taskId, input);
    },
    reorder: async (taskId, queuedSubmissionIds) => {
      await ensureTaskOwner(taskId);
      return delegate.reorder(taskId, queuedSubmissionIds);
    },
    start: async (taskId, queuedSubmissionId) => {
      await ensureTaskOwner(taskId);
      return delegate.start(taskId, queuedSubmissionId);
    },
    update: async (taskId, queuedSubmissionId, input) => {
      await ensureTaskOwner(taskId);
      return delegate.update(taskId, queuedSubmissionId, input);
    },
  };
}
