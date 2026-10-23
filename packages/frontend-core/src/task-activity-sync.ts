import type { TaskActivitySnapshot } from "@codexly/protocol";

const keyFor = (task: Pick<TaskActivitySnapshot, "projectId" | "taskId">) =>
  `${task.projectId}\u0000${task.taskId}`;

/** 两端只投影轻量状态；引擎身份继续由已有任务元数据提供。 */
export function projectTaskActivitySnapshot(snapshot: TaskActivitySnapshot) {
  const waiting = snapshot.status === "waiting";
  // 原生 active 状态可能先于待审批请求的结束通知，审批事实以独立标志为准。
  const approval = snapshot.requiresApproval;
  const attention: "approval" | "input" | "completed" | "failed" | null =
    snapshot.status === "completed"
      ? "completed"
      : snapshot.status === "failed"
        ? "failed"
        : approval
          ? "approval"
          : waiting
            ? "input"
            : null;
  return {
    attention,
    isRunning: snapshot.status === "running" || waiting,
    pendingApprovalRequestIds: approval ? new Set(["native"]) : new Set<string>(),
    projectId: snapshot.projectId,
    taskId: snapshot.taskId,
    taskName: snapshot.taskName,
    ...(snapshot.startedAt === undefined ? {} : { startedAt: snapshot.startedAt }),
  };
}

/** 单次复制活动表；只合入读取开始后未被实时事件修改的条目，避免迟到快照回滚状态。 */
export function reconcileActivitySnapshots<T>(
  current: ReadonlyMap<string, T>,
  baseline: ReadonlyMap<string, T>,
  snapshots: readonly TaskActivitySnapshot[],
  synchronizedKeys: Set<string>,
  update: (snapshot: TaskActivitySnapshot, previous: T | undefined) => T,
): ReadonlyMap<string, T> {
  let next: Map<string, T> | undefined;
  const present = new Set(snapshots.map(keyFor));
  for (const key of synchronizedKeys) {
    if (present.has(key)) continue;
    if (current.get(key) !== baseline.get(key)) continue;
    if (current.has(key)) (next ??= new Map(current)).delete(key);
    synchronizedKeys.delete(key);
  }
  for (const snapshot of snapshots) {
    const key = keyFor(snapshot),
      previous = current.get(key);
    if (previous !== baseline.get(key)) continue;
    synchronizedKeys.add(key);
    const record = update(snapshot, previous);
    if (record !== previous) (next ??= new Map(current)).set(key, record);
  }
  return next ?? current;
}

/** 页面生命周期只安装一次：监听先于首读，通知合并、在途补读、失败退避，无固定轮询。 */
export function installTaskActivitySync<T>(options: {
  read: () => Promise<readonly TaskActivitySnapshot[]>;
  capture: () => T;
  apply: (tasks: readonly TaskActivitySnapshot[], baseline: T) => void;
  subscribe: (refresh: () => void) => (() => void) | Promise<() => void>;
  onError: (error: unknown) => void;
  target?: Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener">;
  window?: Pick<Window, "addEventListener" | "removeEventListener">;
}): () => void {
  let disposed = false,
    running = false,
    dirty = false,
    scheduled = false,
    attempt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let unsubscribe: (() => void) | undefined;
  let subscriptionTimer: ReturnType<typeof setTimeout> | undefined;
  let subscriptionAttempt = 0;
  // await 期间卸载和新通知都可能改变标志，必须在返回边界重新读取。
  const isDisposed = () => disposed;
  const hasPendingRefresh = () => dirty;
  const run = async () => {
    scheduled = false;
    if (disposed || running) return;
    running = true;
    dirty = false;
    const baseline = options.capture();
    try {
      const tasks = await options.read();
      if (!isDisposed()) {
        options.apply(tasks, baseline);
        attempt = 0;
      }
    } catch (error) {
      if (!isDisposed()) {
        options.onError(error);
        timer = setTimeout(refresh, Math.min(1000 * 2 ** attempt++, 30000));
      }
    } finally {
      running = false;
      if (hasPendingRefresh() && !isDisposed()) refresh();
    }
  };
  const refresh = () => {
    if (disposed) return;
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (running) {
      dirty = true;
      return;
    }
    if (!scheduled) {
      scheduled = true;
      queueMicrotask(() => {
        void run();
      });
    }
  };
  const onVisible = () => {
    if (options.target?.visibilityState !== "hidden") refresh();
  };
  // 桥接尚未就绪时仍先恢复状态，并以独立退避重试监听注册；不能等用户再次切换任务。
  const subscribe = () => {
    void Promise.resolve()
      .then(() => options.subscribe(refresh))
      .then((cleanup) => {
        if (disposed) cleanup();
        else {
          unsubscribe = cleanup;
          refresh();
        }
      })
      .catch((error: unknown) => {
        if (disposed) return;
        options.onError(error);
        refresh();
        subscriptionTimer = setTimeout(
          subscribe,
          Math.min(1000 * 2 ** subscriptionAttempt++, 30000),
        );
      });
  };
  subscribe();
  options.target?.addEventListener("visibilitychange", onVisible);
  options.window?.addEventListener("focus", onVisible);
  return () => {
    disposed = true;
    if (timer !== undefined) clearTimeout(timer);
    if (subscriptionTimer !== undefined) clearTimeout(subscriptionTimer);
    unsubscribe?.();
    options.target?.removeEventListener("visibilitychange", onVisible);
    options.window?.removeEventListener("focus", onVisible);
  };
}
