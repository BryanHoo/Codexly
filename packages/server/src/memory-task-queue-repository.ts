import type { AgentQueueRecord, AgentQueueRepository } from "@codexly/core";

export function createMemoryTaskQueueRepository(): AgentQueueRepository {
  const records = new Map<string, AgentQueueRecord[]>();
  const key = (projectId: string, taskId: string) => `${projectId}\u0000${taskId}`;
  return {
    addQueue(record) {
      const queue = records.get(key(record.projectId, record.taskId)) ?? [];
      queue.push(record);
      records.set(key(record.projectId, record.taskId), queue);
      return Promise.resolve(record);
    },
    deleteQueue(projectId, taskId, queuedSubmissionId) {
      const queue = records.get(key(projectId, taskId)) ?? [];
      const index = queue.findIndex((record) => record.id === queuedSubmissionId);
      if (index < 0) return Promise.resolve(false);
      queue.splice(index, 1);
      return Promise.resolve(true);
    },
    listQueue(projectId, taskId) {
      return Promise.resolve([...(records.get(key(projectId, taskId)) ?? [])]);
    },
    reorderQueue(projectId, taskId, queuedSubmissionIds) {
      const queue = records.get(key(projectId, taskId)) ?? [];
      const byId = new Map(queue.map((record) => [record.id, record]));
      if (
        queuedSubmissionIds.length !== queue.length ||
        new Set(queuedSubmissionIds).size !== queue.length ||
        queuedSubmissionIds.some((id) => !byId.has(id))
      ) {
        throw new Error("Task queue order must contain every queued submission exactly once");
      }
      records.set(
        key(projectId, taskId),
        queuedSubmissionIds.map((id) => byId.get(id) as AgentQueueRecord),
      );
      return Promise.resolve();
    },
    updateQueue(projectId, taskId, queuedSubmissionId, input, status) {
      const queue = records.get(key(projectId, taskId)) ?? [];
      const index = queue.findIndex((record) => record.id === queuedSubmissionId);
      const current = queue[index];
      if (current === undefined) return Promise.resolve(undefined);
      const updated = { ...current, input, status };
      queue[index] = updated;
      return Promise.resolve(updated);
    },
  };
}
