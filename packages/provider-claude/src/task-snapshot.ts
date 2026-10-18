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
import {
  claudeProcessCursor,
  paginateClaudeTurns,
  readClaudeHistoryPage,
} from "./history-pagination.js";
import type { Running } from "./session.js";
import { CLAUDE_HISTORY_PAGE_BYTES } from "./item-history.js";

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
  // 取消只终止本次准备，不触碰共享 SDK 消费器或持久化写队列。
  const read = async <T>(operation: () => Promise<T>): Promise<T> => {
    input.signal?.throwIfAborted();
    const result = await operation();
    input.signal?.throwIfAborted();
    return result;
  };
  const last = current?.projection.snapshot() ?? recent.get(id);
  const live = new Map<string, AgentTurn>();
  // 摘要游标与过程游标属于不同读取契约，禁止退回按 Item 分页后再过滤正文。
  if (input.summary && input.cursor?.startsWith("claude-items:"))
    throw new Error("A process cursor cannot paginate Claude summaries");
  const continuation = input.summary
    ? undefined
    : await read(() => readClaudeHistoryPage(config.history, id, input.cursor, input.signal));
  const summaryPage = input.summary
    ? await read(() => config.history.readSummary(id, input.cursor))
    : undefined;
  const page =
    summaryPage ?? continuation ?? (await read(() => config.history.read(id, input.cursor)));
  const turns = page.turns;
  const nextCursor = page.cursor;
  if (current && input.cursor === undefined) {
    for (const projection of current.projections.values()) {
      const turn = projection.snapshot();
      live.set(turn.id, turn);
      const index = turns.findIndex((entry) => entry.id === turn.id);
      if (index >= 0) turns[index] = input.summary ? summarize(turn, turns[index]) : turn;
      else turns.push(turn);
    }
  }
  // 先捕获投影，再等待这批结构化记录已提交的版本；不把读取挂入写队列。
  // 后续 Token 和写入继续消费；最终同步补齐正文，结构变化由共享读取器校验。
  await read(() => config.history.barrier(id));
  if (input.summary) {
    for (let index = 0; index < turns.length; index++) {
      const turn = turns[index];
      if (
        !turn ||
        !live.has(turn.id) ||
        turn.items.some((item) => item.type === "message" && item.role === "user")
      )
        continue;
      try {
        // 内存预览极端裁剪后仍从独立摘要恢复问题，不为活动回合补读过程页。
        turns[index] = summarize(turn, await read(() => config.history.items.summary(id, turn.id)));
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      }
    }
  }
  const metadata =
    recovery?.metadata ??
    current?.projection.metadata() ??
    (await read(() => config.history.metadata(id)));
  if (!current && input.cursor === undefined) {
    const recovered = input.summary
      ? await read(() => config.history.activeSummary(id))
      : await read(() => config.history.active(id));
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
      await read(() => config.history.recoverTurnMetadata(id, failed));
      turns.push(failed);
    }
  }
  if (last && input.cursor === undefined) {
    const index = turns.findIndex((turn) => turn.id === last.id);
    if (index >= 0) turns[index] = input.summary ? summarize(last, turns[index]) : last;
    else turns.push(last);
  }
  if (recovery && input.cursor === undefined) {
    for (const turn of recovery.turns) {
      const index = turns.findIndex((entry) => entry.id === turn.id);
      if (index >= 0) turns[index] = input.summary ? summarize(turn, turns[index]) : turn;
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
    await read(() => store.catalog("task.patch", { id, status: task.status }));
  }
  const visible = input.summary
    ? {
        turns: turns.map((turn) => ({
          ...summarize(turn),
          processCursor: claudeProcessCursor(id, turn.id),
        })),
        cursor: nextCursor,
      }
    : (continuation ??
      (await read(() =>
        paginateClaudeTurns(config.history, id, turns, nextCursor, undefined, live, input.signal),
      )));
  if (input.summary) {
    let bytes = Buffer.byteLength(JSON.stringify(visible.turns));
    // 为实时/恢复摘要腾出空间时，只延后有持久回合索引的旧回合，不能生成过程续页。
    while (bytes > CLAUDE_HISTORY_PAGE_BYTES && visible.turns.length > 1) {
      const first = visible.turns[0];
      const resume = first ? summaryPage?.resume.get(first.id) : undefined;
      if (!resume) break;
      const deferred = visible.turns.shift();
      bytes -= Buffer.byteLength(JSON.stringify(deferred)) + 1;
      visible.cursor = resume;
    }
    if (bytes > CLAUDE_HISTORY_PAGE_BYTES)
      throw new Error("Claude turn summaries exceed page budget");
  }
  const snapshot: AgentProviderTaskSnapshot = {
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
  if (input.snapshotRead) {
    // 历史分页与持久化屏障全部完成后才取最新文本，期间不 await、不阻塞 token。
    // 只替换已有 Item，保持磁盘游标和分页身份；新增 Item、审批及终态仍由结构版本触发重试。
    const refreshed = {
      ...snapshot,
      turns: snapshot.turns.map((turn) => {
        const projection = current?.projections.get(turn.id);
        if (!projection) return turn;
        const latest = new Map(projection.snapshot().items.map((item) => [item.id, item]));
        return { ...turn, items: turn.items.map((item) => latest.get(item.id) ?? item) };
      }),
    };
    // 增长中的正文可能跨越页预算；此时保留原结果交由有界重试，不能损坏续页偏移。
    if (Buffer.byteLength(JSON.stringify(refreshed.turns)) <= CLAUDE_HISTORY_PAGE_BYTES) {
      input.snapshotRead.capture(refreshed);
      return refreshed;
    }
  }
  return snapshot;
}

/** 活动投影可能已裁剪早期正文，保留磁盘摘要中的问题，仅叠加当前稳定答复。 */
function summarize(turn: AgentTurn, stored?: AgentTurn): AgentTurn {
  const user =
    turn.items.find((item) => item.type === "message" && item.role === "user") ??
    stored?.items.find((item) => item.type === "message" && item.role === "user");
  const last = turn.items.at(-1);
  const answer =
    turn.items.findLast(
      (item) =>
        item.type === "message" && item.role === "assistant" && item.phase === "final_answer",
    ) ??
    (turn.status === "completed" &&
    last?.type === "message" &&
    last.role === "assistant" &&
    last.phase === undefined
      ? last
      : undefined);
  return { ...turn, items: [...(user ? [user] : []), ...(answer ? [answer] : [])] };
}
