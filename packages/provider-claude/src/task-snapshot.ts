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
  const last = current?.projection.snapshot() ?? recent.get(id);
  const live = new Map<string, AgentTurn>();
  // 摘要游标与过程游标属于不同读取契约，禁止退回按 Item 分页后再过滤正文。
  if (input.summary && input.cursor?.startsWith("claude-items:"))
    throw new Error("A process cursor cannot paginate Claude summaries");
  const continuation = input.summary
    ? undefined
    : await readClaudeHistoryPage(config.history, id, input.cursor);
  const summaryPage = input.summary
    ? await config.history.readSummary(id, input.cursor)
    : undefined;
  const page = summaryPage ?? continuation ?? (await config.history.read(id, input.cursor));
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
  // 后续 Token 和写入继续消费，快照覆盖边界由两端共用的事件 revision 校验。
  await config.history.barrier(id);
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
        turns[index] = summarize(turn, await config.history.items.summary(id, turn.id));
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      }
    }
  }
  const metadata =
    recovery?.metadata ?? current?.projection.metadata() ?? (await config.history.metadata(id));
  if (!current && input.cursor === undefined) {
    const recovered = input.summary
      ? await config.history.activeSummary(id)
      : await config.history.active(id);
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
    await store.catalog("task.patch", { id, status: task.status });
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
      (await paginateClaudeTurns(config.history, id, turns, nextCursor, undefined, live)));
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
