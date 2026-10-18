import { ClaudeBackgroundTasks } from "./background-tasks.js";
import { randomUUID } from "node:crypto";
import type {
  Options,
  Query,
  SDKUserMessage,
  getSessionMessages,
  getSessionInfo,
  deleteSession,
  forkSession,
} from "@anthropic-ai/claude-agent-sdk";
import type { AgentProviderEventListener, LocalCatalogStore, LocalTask } from "@codexly/core";
import type { AgentItem, AgentTurn } from "@codexly/protocol";
import type { ClaudeConfiguration } from "./config.js";
import type { ClaudeHistory, ClaudeTaskMetadata, ClaudeRecovery } from "./history.js";
import type { ClaudePermissions } from "./permissions.js";
import { ClaudeTurnProjection } from "./turn-projection.js";
import { record } from "./sdk-values.js";
import type { ClaudeUserInput } from "./turn-input.js";
import { refreshClaudeContext } from "./observability.js";

export interface ClaudeSdk {
  query: (input: { prompt: AsyncIterable<SDKUserMessage>; options: Options }) => Query;
  getSessionMessages: typeof getSessionMessages;
  deleteSession: typeof deleteSession;
  forkSession?: typeof forkSession;
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

/** 两端共用记录捕获，不订阅 Token 增量；每条 SDK 消息之后批量落盘。 */
export function createProjection(
  id: string,
  turnId: string,
  prompt: ClaudeUserInput | undefined,
  emit: AgentProviderEventListener,
  backgroundTasks = new ClaudeBackgroundTasks(),
  cwd = "",
) {
  const itemChanges = new Map<string, AgentItem>();
  const projection = new ClaudeTurnProjection(
    id,
    turnId,
    prompt,
    (event) => {
      if (event.type === "item.started" || event.type === "item.completed")
        itemChanges.set(event.itemId, event.payload.item);
      // 完成事件由消费器在回合落盘之后发布。
      if (event.type !== "turn.completed") emit(event);
    },
    undefined,
    true,
    backgroundTasks,
    cwd,
  );
  return { projection, itemChanges };
}

export interface Running {
  sessionId: string;
  query: Query;
  projection: ClaudeTurnProjection;
  permissions: Map<string, ClaudePermissions>;
  projections: Map<string, ClaudeTurnProjection>;
  itemChanges: Map<string, Map<string, AgentItem>>;
  backgroundTasks: ClaudeBackgroundTasks;
  controller: AbortController;
  input: ReturnType<typeof createInput>;
  settingsKey: string;
  timer?: ReturnType<typeof setInterval>;
  idleTimer?: ReturnType<typeof setTimeout> | undefined;
  idleTimeoutMs: number;
  done: Promise<void>;
  closed?: boolean;
  settling?: boolean;
  /** 仅标记被请求中断的前台回合；后台子代理不得继承该状态。 */
  interruptedTurnId?: string | undefined;
  nativeRunning?: boolean;
  hasScheduledWakeup?: boolean;
  createPermissions: (turnId: string) => ClaudePermissions;
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
    running.nativeRunning === true ||
    running.hasScheduledWakeup === true ||
    running.backgroundTasks.size > 0 ||
    (!running.backgroundTasks.hasSnapshot &&
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

/** Stop 快照包含 ScheduleWakeup；只观察待唤醒任务，不阻止 Stop 或重复发送提示词。 */
export function wakeupHooks(getRunning: () => Running | undefined): NonNullable<Options["hooks"]> {
  return {
    Stop: [
      {
        hooks: [
          (input) => {
            if (input.hook_event_name === "Stop") {
              const active = getRunning();
              if (active) {
                active.hasScheduledWakeup = (input.session_crons?.length ?? 0) > 0;
                scheduleIdle(active, active.idleTimeoutMs);
              }
            }
            return Promise.resolve({});
          },
        ],
      },
    ],
  };
}

// WeakMap 的生命周期跟随运行投影，避免历史回合版本在宿主中永久累积。
const savedProjections = new WeakMap<ClaudeTurnProjection, number>();
const savedMetadata = new WeakMap<Running, string>();

/** 捕获调用时版本，写入成功后只确认该版本，不能吞掉 await 期间新到达的 Token。 */
export async function checkpoint(
  id: string,
  projection: ClaudeTurnProjection,
  config: ClaudeConfiguration,
): Promise<void> {
  const revision = projection.changes.revision;
  if (savedProjections.get(projection) === revision) return;
  const items = projection.changes.pendingItems();
  await config.history.checkpoint(
    id,
    projection.snapshot(),
    savedProjections.has(projection) ? items : undefined,
  );
  projection.changes.confirmItems(items);
  savedProjections.set(projection, revision);
}

export async function persist(
  id: string,
  running: Running,
  config: ClaudeConfiguration,
): Promise<void> {
  const entries: ClaudeRecovery["entries"] = [];
  const versions = new Map<ClaudeTurnProjection, number>();
  for (const projection of running.projections.values()) {
    if (savedProjections.get(projection) === projection.changes.revision) continue;
    if (projection.status === "running") await checkpoint(id, projection, config);
    else {
      versions.set(projection, projection.changes.revision);
      entries.push({ turn: projection.snapshot(), mode: "update" });
    }
  }
  const metadata = running.projection.metadata(),
    encoded = JSON.stringify(metadata);
  if (entries.length) {
    await persistTerminals(id, running, config, entries);
    if (!config.persistence.hasPending(id)) {
      for (const [projection, revision] of versions) savedProjections.set(projection, revision);
      savedMetadata.set(running, encoded);
    }
  } else if (savedMetadata.get(running) !== encoded) {
    await config.history.saveMetadata(id, metadata);
    savedMetadata.set(running, encoded);
  }
}

/** 只更新独立的持久化状态，SDK 已给出的成功、失败或中断结果始终保持原样。 */
async function persistTerminal(
  id: string,
  running: Running,
  config: ClaudeConfiguration,
  projection: ClaudeTurnProjection,
  mode: "complete" | "update" = "complete",
): Promise<void> {
  const revision = projection.changes.revision;
  await persistTerminals(id, running, config, [{ turn: projection.snapshot(), mode }]);
  if (!config.persistence.hasPending(id)) savedProjections.set(projection, revision);
}

async function persistTerminals(
  id: string,
  running: Running,
  config: ClaudeConfiguration,
  entries: ClaudeRecovery["entries"],
): Promise<void> {
  const result = await config.persistence.settleAll(id, entries, running.projection.metadata());
  for (const turn of result.turns) {
    const candidate = running.projections.get(turn.id);
    if (candidate) candidate.persistence = turn.persistence;
  }
}

/** 统计独立发布与保存元数据，不持有 settling，也不阻塞 SDK 继续消费后台或下一轮消息。 */
function refreshContext(
  id: string,
  running: Running,
  config: ClaudeConfiguration,
  projection: ClaudeTurnProjection,
  initial = false,
): void {
  const isCurrent = () => !running.closed && running.projection === projection;
  void refreshClaudeContext(running.query, projection, initial, isCurrent)
    .then(async (changed) => {
      // 只保存通过回合与版本校验的统计；后续回合的元数据写入仍由历史队列按序提交。
      if (changed && isCurrent()) await config.history.saveMetadata(id, projection.metadata());
    })
    .catch(() => {
      // 观测及其可选元数据写入失败均不改变已经持久化的真实执行终态。
    });
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
        // 首条消息已是终态时，由下方恢复事务一并保存初始化证据，写盘失败不能遮蔽真实结果。
        if (message.type !== "result")
          await config.history.saveMetadata(id, running.projection.metadata());
      }
      // SDK 自行消费后台通知或定时唤醒，不会再次经过 startTurn。
      // 仅主线程活动创建新的展示回合，子代理迟到消息仍归属原回合，且不伪造用户输入。
      const rootMessage = !value["parent_tool_use_id"] && !value["agent_id"];
      if (rootMessage && message.type === "system" && message.subtype === "session_state_changed")
        running.nativeRunning = message.state !== "idle";
      // 后台工具的审批也会发 requires_action，只保活，不能创建永远等不到 result 的空回合。
      const startsContinuation =
        rootMessage &&
        (message.type === "assistant" ||
          (message.type === "stream_event" && message.event.type === "message_start") ||
          (message.type === "system" &&
            message.subtype === "session_state_changed" &&
            message.state === "running"));
      if (running.projection.status !== "running" && startsContinuation) {
        const turnId = randomUUID();
        const { projection, itemChanges } = createProjection(
          id,
          turnId,
          undefined,
          emit,
          running.backgroundTasks,
          running.projection.cwd,
        );
        projection.restoreMetadata(running.projection.metadata());
        running.projection = projection;
        running.projections.set(turnId, projection);
        running.itemChanges.set(turnId, itemChanges);
        running.permissions.set(turnId, running.createPermissions(turnId));
        clearTimeout(running.idleTimer);
        running.idleTimer = undefined;
        await checkpoint(id, projection, config);
        await store.catalog("task.patch", { id, status: "active", updatedAt: Date.now() / 1000 });
        emit({
          type: "turn.started",
          taskId: id,
          turnId,
          payload: { turn: projection.snapshot() },
        });
      }
      if (!running.backgroundTasks.receive(message)) continue;
      const projection =
        [...running.projections.values()].find((candidate) => candidate.ownsMessage(message)) ??
        running.projection;
      const wasRunning = projection.status === "running";
      projection.receive(message, true, running.interruptedTurnId === projection.id);
      // 仅落盘结构化块和工具状态，Token 增量不产生磁盘写入；消费器背压限制待写内存。
      const changes = running.itemChanges.get(projection.id);
      if (changes?.size) {
        const batch = [...changes.values()];
        await config.history.saveItems(id, projection.id, batch);
        projection.changes.confirmItems(batch);
        for (const item of batch) if (changes.get(item.id) === item) changes.delete(item.id);
      }
      if (message.type === "system" && message.subtype === "init")
        refreshContext(id, running, config, projection, true);
      const completed = projection.status !== "running";
      if (wasRunning && completed) {
        running.settling = true;
        await persistTerminal(id, running, config, projection);
        await store.catalog("task.patch", {
          id,
          status: hasWork(running) || config.persistence.hasPending(id) ? "active" : "idle",
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
        refreshContext(id, running, config, projection);
      } else if (
        completed &&
        projection.ownsMessage(message) &&
        (message.type === "result" ||
          (message.type === "system" &&
            ["task_notification", "task_updated"].includes(message.subtype)))
      ) {
        // Token 热路径只更新内存；终态立即落盘，中间过程由有界检查点合并保存。
        await persistTerminal(id, running, config, projection, "update");
      }
      for (const [turnId, candidate] of running.projections) {
        if (
          candidate !== running.projection &&
          candidate.status !== "running" &&
          !candidate.hasBackgroundWork &&
          !candidate.hasPendingTaskNotifications
        ) {
          running.projections.delete(turnId);
          running.itemChanges.delete(turnId);
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
    let terminal: ClaudeTurnProjection | undefined;
    const entries: ClaudeRecovery["entries"] = [];
    for (const projection of running.projections.values()) {
      const wasRunning = projection.status === "running";
      projection.close(status, failure);
      entries.push({ turn: projection.snapshot(), mode: wasRunning ? "complete" : "update" });
      if (wasRunning) terminal = projection;
    }
    await persistTerminals(id, running, config, entries);
    const turn = running.projection.snapshot();
    onClose(turn);
    await store
      .catalog("task.patch", {
        id,
        status: config.persistence.hasPending(id)
          ? "active"
          : turn.status === "failed"
            ? "failed"
            : "idle",
        updatedAt: Date.now() / 1000,
      })
      .catch(() => undefined);
    if (terminal)
      emit({
        type: "turn.completed",
        taskId: id,
        turnId: terminal.id,
        payload: { turn: terminal.snapshot() },
      });
  }
}
