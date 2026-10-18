import type {
  AgentProvider,
  AgentProviderTaskSnapshot,
  ReadAgentTaskInput,
} from "./agent-provider.js";

export class TaskSnapshotBusyError extends Error {
  readonly code = "TASK_SNAPSHOT_BUSY";
  readonly statusCode = 503;
  readonly retryable = true;
  constructor() {
    super("Task snapshot is temporarily busy; retry the snapshot request");
    this.name = "TaskSnapshotBusyError";
  }
}

/** 快照与覆盖边界必须作为同一次读取交付；异步历史准备不持有执行器锁。 */
export async function readTaskWithCheckpoint<Checkpoint>(
  provider: Pick<AgentProvider, "readTask" | "subscribeEvents">,
  taskId: string,
  input: ReadAgentTaskInput,
  captureCheckpoint: (snapshot: AgentProviderTaskSnapshot) => Checkpoint,
  options: Readonly<{ timeoutMs?: number }> = {},
): Promise<Readonly<{ snapshot: AgentProviderTaskSnapshot; checkpoint: Checkpoint }> | undefined> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new RangeError("Invalid snapshot timeout");
  input.signal?.throwIfAborted();
  const controller = new AbortController();
  const signal = controller.signal;
  const deadline = Date.now() + timeoutMs;
  const abort = () => {
    controller.abort(input.signal?.reason);
  };
  input.signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(() => {
    controller.abort(new TaskSnapshotBusyError());
  }, timeoutMs);
  const check = () => {
    signal.throwIfAborted();
    // 同步处理或微任务持续占用时，计时器可能尚未执行；捕获前仍检查绝对截止时间。
    if (Date.now() >= deadline) throw new TaskSnapshotBusyError();
  };
  const { promise: cancelled, reject: rejectCancelled } = Promise.withResolvers<never>();
  const onAbort = () => {
    rejectCancelled(signal.reason);
  };
  signal.addEventListener("abort", onAbort, { once: true });
  const prepared = new Map<string, Promise<unknown>>();
  let unsubscribe: (() => void) | undefined;
  try {
    let revision = 0;
    let structuralRevision = 0;
    // 只保存有界的增量身份，不保留 token 正文或增长中的事件队列。
    const deltaItems = new Set<string>();
    unsubscribe = provider.subscribeEvents((event) => {
      if (event.taskId !== taskId) return;
      revision++;
      if (event.type !== "message.delta") structuralRevision++;
      else if (deltaItems.size < 1024) deltaItems.add(JSON.stringify([event.turnId, event.itemId]));
      else structuralRevision++;
    });
    for (let attempt = 0; attempt < 2; attempt++) {
      check();
      const before = revision;
      const structureBefore = structuralRevision;
      deltaItems.clear();
      let captured: { snapshot: AgentProviderTaskSnapshot; checkpoint: Checkpoint } | undefined;
      let accepting = true;
      const snapshotRead: NonNullable<ReadAgentTaskInput["snapshotRead"]> = {
        prepare<T>(key: string, read: () => Promise<T>): Promise<T> {
          check();
          let result = prepared.get(key);
          if (!result) {
            result = read();
            prepared.set(key, result);
          }
          return Promise.race([result as Promise<T>, cancelled]);
        },
        capture(snapshot) {
          check();
          if (!accepting || captured || structureBefore !== structuralRevision) return;
          // Provider 保证当前正文覆盖层与此调用同步；不能在此与 checkpoint 之间 await。
          captured = { snapshot, checkpoint: captureCheckpoint(snapshot) };
        },
      };
      let snapshot: AgentProviderTaskSnapshot | undefined;
      try {
        snapshot = await Promise.race([
          provider.readTask(taskId, { ...input, signal, snapshotRead }),
          cancelled,
        ]);
      } finally {
        // 取消后迟到的 Provider 结果不得写出宿主响应帧或捕获新边界。
        accepting = false;
      }
      check();
      if (captured) return captured;
      if (before !== revision) {
        // 摘要契约有意省略过程正文；只有不出现在摘要中的文本增量可以跳过重读。
        const invisibleDeltas =
          input.summary === true &&
          snapshot !== undefined &&
          structureBefore === structuralRevision &&
          !snapshot.turns.some((turn) =>
            turn.items.some((item) => deltaItems.has(JSON.stringify([turn.id, item.id]))),
          );
        if (!invisibleDeltas) continue;
      }
      if (snapshot === undefined) return undefined;
      return { snapshot, checkpoint: captureCheckpoint(snapshot) };
    }
    throw new TaskSnapshotBusyError();
  } finally {
    unsubscribe?.();
    clearTimeout(timeout);
    input.signal?.removeEventListener("abort", abort);
    signal.removeEventListener("abort", onAbort);
    prepared.clear();
  }
}
