import { localTaskMetadata as claudeTask } from "@codexly/core";
import type {
  AgentProviderTaskSnapshot,
  LocalCatalogStore,
  LocalTask,
  ReadAgentTaskInput,
} from "@codexly/core";
import type { AgentTurn } from "@codexly/protocol";
import type { ClaudeConfiguration } from "./config.js";
import type { ClaudeRecoverySnapshot } from "./persistence.js";
import { paginateClaudeTurns, readClaudeHistoryPage } from "./history-pagination.js";
import type { Running } from "./session.js";

/** 终态恢复优先于运行检查点和最近回合缓存，分页读取不混入其他页的恢复回合。 */
export async function readClaudeTaskSnapshot({
  task,
  input,
  config,
  store,
  current,
  recent,
  starting,
  recovery,
}: {
  task: LocalTask;
  input: ReadAgentTaskInput;
  config: ClaudeConfiguration;
  store: LocalCatalogStore;
  current: Running | undefined;
  recent: Map<string, AgentTurn>;
  starting: boolean;
  recovery: ClaudeRecoverySnapshot | undefined;
}): Promise<AgentProviderTaskSnapshot> {
  const id = task.id;
  const last = current?.projection.snapshot() ?? recent.get(id);
  const live = new Map<string, AgentTurn>();
  const continuation = await readClaudeHistoryPage(config.history, id, input.cursor);
  const page = continuation ?? (await config.history.read(id, input.cursor));
  const turns = page.turns;
  const nextCursor = page.cursor;
  if (current && input.cursor === undefined) {
    for (const projection of current.projections.values()) {
      const turn = projection.snapshot();
      live.set(turn.id, turn);
      const index = turns.findIndex((entry) => entry.id === turn.id);
      if (index >= 0) turns[index] = turn;
      else turns.push(turn);
    }
  }
  // 先捕获投影，再等待这批结构化记录已提交的版本；不把读取挂入写队列。
  // 后续 Token 和写入继续消费，快照覆盖边界由两端共用的事件 revision 校验。
  await config.history.barrier(id);
  const metadata =
    recovery?.metadata ?? current?.projection.metadata() ?? (await config.history.metadata(id));
  if (!current && input.cursor === undefined) {
    const recovered = await config.history.active(id);
    if (
      recovered &&
      !recovery?.turns.some((turn) => turn.id === recovered.id) &&
      !turns.some((turn) => turn.id === recovered.id)
    ) {
      const failed: AgentTurn = {
        ...recovered,
        status: "failed",
        error: "Claude process ended before completing this turn",
        completedAt: null,
      };
      await config.history.recoverTurnMetadata(id, failed);
      turns.push(failed);
    }
  }
  if (last && input.cursor === undefined) {
    const index = turns.findIndex((turn) => turn.id === last.id);
    if (index >= 0) turns[index] = last;
    else turns.push(last);
  }
  if (recovery && input.cursor === undefined) {
    for (const turn of recovery.turns) {
      const index = turns.findIndex((entry) => entry.id === turn.id);
      if (index >= 0) turns[index] = turn;
      else turns.push(turn);
      const projection = current?.projections.get(turn.id);
      if (projection) projection.persistence = turn.persistence;
      if (recent.get(id)?.id === turn.id) recent.set(id, turn);
    }
  }
  const terminal = input.cursor === undefined ? turns.at(-1) : last;
  if (
    !current &&
    !starting &&
    task.status === "active" &&
    !recovery?.pending &&
    input.cursor === undefined
  ) {
    // 恢复终态合并完成后再解除过期标记，读取旧分页不能改变最新回合的运行状态。
    task.status =
      terminal?.status === "completed" || terminal?.status === "interrupted" ? "idle" : "failed";
    await store.catalog("task.patch", { id, status: task.status });
  }
  const visible =
    continuation ??
    (await paginateClaudeTurns(config.history, id, turns, nextCursor, undefined, live));
  return {
    ...claudeTask(task),
    contextUsage: metadata?.contextUsage ?? null,
    goal: null,
    plan: metadata?.plan ?? null,
    pendingRequests: current
      ? [...current.permissions.values()].flatMap((permissions) => permissions.pending())
      : [],
    status:
      current && (last?.status === "running" || current.settling)
        ? "running"
        : (terminal ? terminal.status === "failed" : task.status === "failed")
          ? "failed"
          : "idle",
    threadConfiguration: { model: metadata?.model ?? null, reasoningEffort: null },
    turns: visible.turns,
    turnsNextCursor: visible.cursor,
  };
}
