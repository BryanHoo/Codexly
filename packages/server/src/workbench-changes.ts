import type { EventCheckpoint, WorkbenchChange } from "@codexly/protocol";
import type { AgentProviderEvent } from "@codexly/core";

import { TaskActivityIndex } from "./task-activity-index.js";

export class WorkbenchChanges {
  readonly taskActivities = new TaskActivityIndex();
  readonly #listeners = new Set<(change: WorkbenchChange) => void>();

  forgetProject(projectId: string): void {
    this.taskActivities.forgetProject(projectId);
    this.publish({ type: "task-activity.changed" });
  }

  subscribe(listener: (change: WorkbenchChange) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  publish(change: WorkbenchChange): void {
    // 仅在变更已落盘或 Provider 发出权威事件后通知，避免另一设备读取到旧集合。
    for (const listener of this.#listeners) listener(change);
  }

  publishAgentEvent(
    projectId: string,
    event: AgentProviderEvent,
    checkpoint?: () => EventCheckpoint,
  ): void {
    if (this.taskActivities.observe(projectId, event, checkpoint))
      this.publish({ type: "task-activity.changed" });
    // 只在问题消息成型和回合边界校准，逐 token 的消息增量不触发 HTTP 请求。
    if (
      event.type === "turn.started" ||
      event.type === "turn.completed" ||
      (event.type === "item.completed" &&
        event.payload.item.type === "message" &&
        (event.payload.item.questions?.length ?? 0) > 0)
    ) {
      this.publish({ type: "async-questions.changed", projectId, taskId: event.taskId });
    }
  }
}
