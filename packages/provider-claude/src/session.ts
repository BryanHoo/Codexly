import type {
  Options,
  Query,
  SDKUserMessage,
  getSessionMessages,
  getSessionInfo,
} from "@anthropic-ai/claude-agent-sdk";
import type { AgentProviderEventListener, LocalCatalogStore, LocalTask } from "@codexly/core";
import type { AgentTurn } from "@codexly/protocol";
import type { ClaudeConfiguration } from "./config.js";
import type { ClaudeHistory, ClaudeTaskMetadata } from "./history.js";
import type { ClaudePermissions } from "./permissions.js";
import { type ClaudeTurnProjection, record } from "./turn-projection.js";
import { refreshClaudeContext } from "./observability.js";

export interface ClaudeSdk {
  query: (input: { prompt: AsyncIterable<SDKUserMessage>; options: Options }) => Query;
  getSessionMessages: typeof getSessionMessages;
  getSessionInfo?: typeof getSessionInfo;
}

/** 绑定早于 SDK 启动；只有从未建立原生上下文的任务才允许按原 UUID 首次创建。 */
export async function canResume(
  task: LocalTask,
  sdk: ClaudeSdk,
  history: ClaudeHistory,
  metadata: ClaudeTaskMetadata | undefined,
): Promise<boolean> {
  if (!task.sessionId) return false;
  if (!sdk.getSessionInfo || (await sdk.getSessionInfo(task.sessionId, { dir: task.cwd })))
    return true;
  // 旧版缺少初始化标记时保守检查 UI 记录，绝不把展示历史误当成模型上下文。
  const initialized =
    metadata?.sessionInitialized ??
    ((await history.read(task.id)).turns.length > 0 ||
      (await history.active(task.id)) !== undefined);
  if (initialized)
    throw new Error(
      "无法恢复 Claude 会话：原生历史不存在，原上下文无法恢复。请恢复会话文件或新建聊天。",
    );
  return false;
}

export interface Running {
  sessionId: string;
  query: Query;
  projection: ClaudeTurnProjection;
  permissions: Map<string, ClaudePermissions>;
  projections: Map<string, ClaudeTurnProjection>;
  backgroundTasks: Set<string>;
  controller: AbortController;
  input: ReturnType<typeof createInput>;
  settingsKey: string;
  timer?: ReturnType<typeof setInterval>;
  idleTimer?: ReturnType<typeof setTimeout> | undefined;
  idleTimeoutMs: number;
  done: Promise<void>;
  closed?: boolean;
  settling?: boolean;
  hasBackgroundSnapshot?: boolean;
}

/** 单个前台回合顺序入队；保持输入开放，父 result 不得结束 SDK 的 stdin。 */
export function createInput() {
  let ended = false;
  let pending = Promise.withResolvers<SDKUserMessage | undefined>();
  return {
    send(message: SDKUserMessage) {
      pending.resolve(message);
    },
    close() {
      ended = true;
      pending.resolve(undefined);
    },
    async *[Symbol.asyncIterator]() {
      for (;;) {
        if (ended) return;
        const message = await pending.promise;
        pending = Promise.withResolvers<SDKUserMessage | undefined>();
        if (!message) return;
        yield message;
      }
    },
  };
}

export function hasWork(running: Running): boolean {
  return (
    running.projection.status === "running" ||
    running.backgroundTasks.size > 0 ||
    (!running.hasBackgroundSnapshot &&
      [...running.projections.values()].some((projection) => projection.hasBackgroundWork))
  );
}

export function stop(running: Running): void {
  if (running.closed) return;
  running.closed = true;
  clearTimeout(running.idleTimer);
  running.controller.abort();
  for (const permissions of running.permissions.values()) permissions.close();
  running.input.close();
  try {
    running.query.close();
  } catch {
    /* 进程退出后仍继续回收状态。 */
  }
}

export function scheduleIdle(running: Running, idleTimeoutMs: number): void {
  if (hasWork(running)) {
    clearTimeout(running.idleTimer);
    running.idleTimer = undefined;
  } else if (!running.idleTimer) {
    // 只按无前台、无后台工作计时；无消息不代表仍在执行的后台任务已空闲。
    running.idleTimer = setTimeout(() => {
      if (!hasWork(running)) stop(running);
    }, idleTimeoutMs);
    running.idleTimer.unref();
  }
}

export async function persist(
  id: string,
  running: Running,
  config: ClaudeConfiguration,
): Promise<void> {
  for (const projection of running.projections.values()) {
    if (projection.status === "running") await config.history.checkpoint(id, projection.snapshot());
    else await config.history.update(id, projection.snapshot());
  }
  await config.history.saveMetadata(id, running.projection.metadata());
}

export async function consume(
  id: string,
  running: Running,
  config: ClaudeConfiguration,
  store: LocalCatalogStore,
  emit: AgentProviderEventListener,
  onClose: (turn: AgentTurn) => void,
): Promise<void> {
  let failure: string | undefined;
  try {
    for await (const message of running.query) {
      const value = record(message),
        actualSession = value["session_id"];
      if (typeof actualSession === "string" && actualSession && actualSession !== running.sessionId)
        throw new Error("Claude changed the bound session identity");
      if (!running.projection.sessionInitialized) {
        // 首条 SDK 消息即确认原生会话已运行；先持久化，再公开输出，崩溃后也不能静默重建。
        running.projection.sessionInitialized = true;
        await config.history.saveMetadata(id, running.projection.metadata());
      }
      const projection =
        [...running.projections.values()].find((candidate) => candidate.ownsMessage(message)) ??
        running.projection;
      const wasRunning = projection.status === "running";
      projection.receive(message);
      // 原生任务包括 Bash 等非 Agent 工具；不能仅凭可见子代理决定关闭进程。
      if (message.type === "system") {
        if (message.subtype === "background_tasks_changed") {
          running.hasBackgroundSnapshot = true;
          running.backgroundTasks = new Set(message.tasks.map((task) => task.task_id));
        } else if (
          message.subtype === "task_started" &&
          !running.hasBackgroundSnapshot &&
          message.is_backgrounded !== false
        ) {
          running.backgroundTasks.add(message.task_id);
        } else if (message.subtype === "task_notification" && !running.hasBackgroundSnapshot) {
          running.backgroundTasks.delete(message.task_id);
        } else if (
          message.subtype === "task_updated" &&
          !running.hasBackgroundSnapshot &&
          message.patch.is_backgrounded === true
        ) {
          running.backgroundTasks.add(message.task_id);
        }
        if (running.backgroundTasks.size > 512)
          throw new Error("Claude background task capacity exceeded");
      }
      if (message.type === "system" && message.subtype === "init")
        void refreshClaudeContext(running.query, projection, true);
      const completed = projection.status !== "running";
      if (wasRunning && completed) {
        running.settling = true;
        await refreshClaudeContext(running.query, projection);
        await config.history.complete(id, projection.snapshot());
        await config.history.saveMetadata(id, projection.metadata());
        await store.catalog("task.patch", {
          id,
          status: hasWork(running) ? "active" : "idle",
          updatedAt: Date.now() / 1000,
        });
        // 前台完成即解锁下一回合，背景通知继续通过同一消费器交付。
        running.settling = false;
        emit({
          type: "turn.completed",
          taskId: id,
          turnId: projection.id,
          payload: { turn: projection.snapshot() },
        });
      } else if (
        completed &&
        projection.ownsMessage(message) &&
        (message.type === "result" ||
          (message.type === "system" && message.subtype === "task_notification"))
      ) {
        // Token 热路径只更新内存；终态立即落盘，中间过程由有界检查点合并保存。
        await config.history.update(id, projection.snapshot());
      }
      for (const [turnId, candidate] of running.projections) {
        if (
          candidate !== running.projection &&
          candidate.status !== "running" &&
          !candidate.hasBackgroundWork
        ) {
          running.projections.delete(turnId);
          running.permissions.get(turnId)?.close();
          running.permissions.delete(turnId);
        }
      }
      scheduleIdle(running, running.idleTimeoutMs);
    }
    if (!running.controller.signal.aborted && hasWork(running))
      failure = "Claude stream ended before all work completed";
  } catch (error) {
    if (!running.controller.signal.aborted)
      failure = error instanceof Error ? error.message : "Claude execution failed";
  } finally {
    clearInterval(running.timer);
    stop(running);
    const status = failure ? "failed" : "interrupted";
    let terminal: AgentTurn | undefined;
    for (const projection of running.projections.values()) {
      const wasRunning = projection.status === "running";
      projection.close(status, failure);
      if (wasRunning) {
        await config.history.complete(id, projection.snapshot()).catch(() => undefined);
        terminal = projection.snapshot();
      } else await config.history.update(id, projection.snapshot()).catch(() => undefined);
    }
    const turn = running.projection.snapshot();
    await config.history.saveMetadata(id, running.projection.metadata()).catch(() => undefined);
    onClose(turn);
    await store
      .catalog("task.patch", {
        id,
        status: failure || turn.status === "failed" ? "failed" : "idle",
        updatedAt: Date.now() / 1000,
      })
      .catch(() => undefined);
    if (terminal)
      emit({
        type: "turn.completed",
        taskId: id,
        turnId: terminal.id,
        payload: { turn: terminal },
      });
  }
}
