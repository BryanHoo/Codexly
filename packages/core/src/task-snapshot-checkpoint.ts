import type {
  AgentProvider,
  AgentProviderTaskSnapshot,
  ReadAgentTaskInput,
} from "./agent-provider.js";

/** 快照与覆盖边界必须作为同一次读取交付；异步历史准备不持有执行器锁。 */
export async function readTaskWithCheckpoint<Checkpoint>(
  provider: Pick<AgentProvider, "readTask" | "subscribeEvents">,
  taskId: string,
  input: ReadAgentTaskInput,
  captureCheckpoint: (snapshot: AgentProviderTaskSnapshot) => Checkpoint,
): Promise<Readonly<{ snapshot: AgentProviderTaskSnapshot; checkpoint: Checkpoint }> | undefined> {
  let revision = 0;
  const unsubscribe = provider.subscribeEvents((event) => {
    if (event.taskId === taskId) revision++;
  });
  try {
    // 只重试本任务发生变更的读取，避免其他任务的 token 造成无关重读。
    // 持续繁忙时明确失败，禁止返回不一致结果，也不能无限占用磁盘和请求资源。
    for (let attempt = 0; attempt < 8; attempt++) {
      const before = revision;
      const snapshot = await provider.readTask(taskId, input);
      if (before !== revision) continue;
      if (snapshot === undefined) return undefined;
      // 校验与边界捕获之间不能 await；宿主可在此同步写出有序响应帧。
      return { snapshot, checkpoint: captureCheckpoint(snapshot) };
    }
    throw new Error("Task changed during snapshot preparation; retry the snapshot request");
  } finally {
    unsubscribe();
  }
}
