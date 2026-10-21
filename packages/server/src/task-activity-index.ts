import type { AgentProviderTaskSnapshot, AgentProviderEvent } from "@codexly/core";
import type { AgentTask, EventCheckpoint, TaskActivitySnapshot } from "@codexly/protocol";

interface ActivityRecord {
  snapshot: TaskActivitySnapshot;
  requests: Map<string, boolean>;
}
// 高频正文事件直接跳过，不为每个 token 创建任务键或读取 checkpoint。
const ACTIVITY_EVENTS = new Set([
  "turn.started",
  "turn.completed",
  "task.status_updated",
  "provider.error",
  "pending_request.created",
  "pending_request.resolved",
  "pending_request.expired",
  "task.metadata_changed",
  "task.removed",
]);
const keyFor = (projectId: string, taskId: string) => `${projectId}\u0000${taskId}`;
const isApproval = (type: string) =>
  ["command_approval", "file_change_approval", "permissions_approval", "mcp_elicitation"].includes(
    type,
  );

/** 后端独立保存轻量状态；任务分页、事件历史淘汰和浏览器刷新都不清空此索引。 */
export class TaskActivityIndex {
  readonly #activeProjects = new Map<string, number>();
  readonly #records = new Map<string, ActivityRecord>();
  readonly #titles = new Map<string, string>();
  #version = 0;

  hasActiveProject(projectId: string): boolean {
    return (this.#activeProjects.get(projectId) ?? 0) > 0;
  }

  #updateActiveCount(
    projectId: string,
    previous: TaskActivitySnapshot | undefined,
    status?: TaskActivitySnapshot["status"],
  ): void {
    const wasActive = previous?.status === "running" || previous?.status === "waiting";
    const active = status === "running" || status === "waiting";
    if (active === wasActive) return;
    const count = (this.#activeProjects.get(projectId) ?? 0) + (active ? 1 : -1);
    if (count > 0) this.#activeProjects.set(projectId, count);
    else this.#activeProjects.delete(projectId);
  }

  snapshot(): readonly TaskActivitySnapshot[] {
    return [...this.#records.values()].map(({ snapshot }) => ({
      ...snapshot,
      taskName: this.#titles.get(keyFor(snapshot.projectId, snapshot.taskId)) ?? snapshot.taskName,
    }));
  }

  remember(tasks: readonly Pick<AgentTask, "id" | "projectId" | "title">[]): void {
    for (const task of tasks) this.#titles.set(keyFor(task.projectId, task.id), task.title);
    // 标题缓存有界；活动记录自身保留标题，不会因此丢掉活动任务。
    while (this.#titles.size > 2048) {
      const oldest = this.#titles.keys().next().value;
      if (oldest === undefined) break;
      this.#titles.delete(oldest);
    }
  }

  acknowledge(projectId: string, taskId: string, version: number): boolean {
    const key = keyFor(projectId, taskId),
      current = this.#records.get(key)?.snapshot;
    // 只确认用户实际看过的版本；迟到确认不能清除下一回合的完成提醒。
    if (
      !current ||
      current.version !== version ||
      current.status === "running" ||
      current.status === "waiting"
    )
      return false;
    return this.#records.delete(key);
  }

  forgetProject(projectId: string): void {
    this.#activeProjects.delete(projectId);
    for (const [key, record] of this.#records)
      if (record.snapshot.projectId === projectId) this.#records.delete(key);
    for (const key of this.#titles.keys())
      if (key.startsWith(`${projectId}\u0000`)) this.#titles.delete(key);
  }

  /** 详情读取也能补种遗漏的状态，但只能使用读取时捕获的 checkpoint。 */
  observeSnapshot(snapshot: AgentProviderTaskSnapshot, checkpoint: EventCheckpoint): boolean {
    const key = keyFor(snapshot.projectId, snapshot.id),
      previous = this.#records.get(key);
    if (
      previous?.snapshot.checkpoint?.sessionId === checkpoint.sessionId &&
      previous.snapshot.checkpoint.sequence > checkpoint.sequence
    )
      return false;
    this.remember([snapshot]);
    const requests = new Map(
      snapshot.pendingRequests.map((request) => [request.requestId, isApproval(request.type)]),
    );
    const status = requests.size
      ? "waiting"
      : snapshot.status === "running"
        ? "running"
        : snapshot.status === "failed"
          ? "failed"
          : previous === undefined
            ? undefined
            : previous.snapshot.status === "running" || previous.snapshot.status === "waiting"
              ? "completed"
              : previous.snapshot.status;
    if (status === undefined) return false;
    const startedAt =
      snapshot.turns.findLast((turn) => turn.status === "running")?.startedAt ??
      previous?.snapshot.startedAt;
    const requiresApproval = [...requests.values()].some(Boolean);
    if (
      previous?.snapshot.status === status &&
      previous.snapshot.requiresApproval === requiresApproval &&
      previous.snapshot.startedAt === startedAt &&
      previous.snapshot.taskName === snapshot.title
    )
      return false;
    this.#updateActiveCount(snapshot.projectId, previous?.snapshot, status);
    this.#records.set(key, {
      requests,
      snapshot: {
        projectId: snapshot.projectId,
        taskId: snapshot.id,
        taskName: snapshot.title,
        status,
        requiresApproval,
        ...(startedAt === undefined ? {} : { startedAt }),
        checkpoint,
        version: ++this.#version,
      },
    });
    return true;
  }

  observe(
    projectId: string,
    event: AgentProviderEvent,
    checkpoint?: () => EventCheckpoint,
  ): boolean {
    if (!ACTIVITY_EVENTS.has(event.type)) return false;
    const key = keyFor(projectId, event.taskId),
      previous = this.#records.get(key);
    if (event.type === "task.removed") {
      this.#updateActiveCount(projectId, previous?.snapshot);
      this.#titles.delete(key);
      return this.#records.delete(key);
    }
    if (event.type === "task.metadata_changed") {
      if (event.payload.title === undefined) return false;
      this.remember([{ projectId, id: event.taskId, title: event.payload.title }]);
      if (!previous || previous.snapshot.taskName === event.payload.title) return false;
      previous.snapshot = { ...previous.snapshot, taskName: event.payload.title };
      return true;
    }
    let status: TaskActivitySnapshot["status"];
    let startedAt = previous?.snapshot.startedAt;
    const requests = previous?.requests ?? new Map<string, boolean>();
    switch (event.type) {
      case "turn.started":
        status = "running";
        startedAt = event.payload.turn.startedAt ?? undefined;
        requests.clear();
        break;
      case "turn.completed":
        status = event.payload.turn.status === "completed" ? "completed" : "failed";
        requests.clear();
        break;
      case "task.status_updated":
        if (event.payload.status === "running") status = requests.size ? "waiting" : "running";
        else if (event.payload.status === "failed") {
          status = "failed";
          requests.clear();
        } else if (
          previous?.snapshot.status === "running" ||
          previous?.snapshot.status === "waiting"
        ) {
          // 原生 idle 是停止执行的权威事实；缺少 turn.completed 时仍须收敛状态。
          status = "completed";
          requests.clear();
        } else return false;
        break;
      case "provider.error":
        if (event.payload.willRetry) return false;
        status = "failed";
        requests.clear();
        break;
      case "pending_request.created":
        requests.set(event.payload.request.requestId, isApproval(event.payload.request.type));
        status = "waiting";
        break;
      case "pending_request.resolved":
      case "pending_request.expired":
        if (!requests.delete(event.payload.request.requestId)) return false;
        status = requests.size ? "waiting" : "running";
        break;
      default:
        return false;
    }
    const requiresApproval = [...requests.values()].some(Boolean);
    if (
      previous?.snapshot.status === status &&
      previous.snapshot.startedAt === startedAt &&
      previous.snapshot.requiresApproval === requiresApproval &&
      event.type !== "turn.completed"
    )
      return false;
    this.#updateActiveCount(projectId, previous?.snapshot, status);
    this.#records.set(key, {
      requests,
      snapshot: {
        ...(checkpoint === undefined ? {} : { checkpoint: checkpoint() }),
        projectId,
        taskId: event.taskId,
        taskName: this.#titles.get(key) ?? previous?.snapshot.taskName ?? event.taskId,
        status,
        requiresApproval,
        ...(startedAt === undefined ? {} : { startedAt }),
        version: ++this.#version,
      },
    });
    return true;
  }
}
