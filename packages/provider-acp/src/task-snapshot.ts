import {
  localTaskMetadata,
  type LocalTask,
  type ReadAgentTaskInput,
  type AgentProviderTaskSnapshot,
} from "@codexly/core";
import type { AgentEngine } from "@codexly/protocol";
import type { AcpSessionState } from "@codexly/protocol";
import { AcpHistoryCorruptionError, type AcpHistory } from "./history.js";
import type { AcpEventProjection } from "./event-projection.js";

/** 异步历史准备完成后同步读取活动投影并捕获边界，不在正文与 checkpoint 之间 await。 */
export async function readAcpTaskSnapshot(
  task: LocalTask,
  input: ReadAgentTaskInput,
  source: {
    engine: AgentEngine;
    history: AcpHistory;
    load(repairHistory?: boolean): Promise<unknown>;
    active(): AcpEventProjection | undefined;
    pending(): AgentProviderTaskSnapshot["pendingRequests"];
    contextUsage(): AgentProviderTaskSnapshot["contextUsage"];
    sessionState(): AcpSessionState | undefined;
  },
): Promise<AgentProviderTaskSnapshot> {
  const previous = source.active();
  let page = await source.history.read(task.id, input.cursor).catch(async (error: unknown) => {
    // 只修复当前投影；旧游标、普通 I/O 错误和活动回合不触发整份回放。
    if (
      input.cursor ||
      source.active() ||
      !task.sessionId ||
      !(error instanceof AcpHistoryCorruptionError)
    )
      throw error;
    input.signal?.throwIfAborted();
    await source.load(true);
    return null;
  });
  if (page === null) page = await source.history.read(task.id);
  else if (!input.cursor && !previous && task.sessionId && page.turns.length === 0) {
    await source.load();
    page = await source.history.read(task.id);
  }
  // 读旧游标期间，历史提交可能刚好移除活动投影；重新读一次才可捕获新 checkpoint。
  if (!input.cursor && previous && previous !== source.active())
    page = await source.history.read(task.id);
  input.signal?.throwIfAborted();
  const projection = source.active(),
    active = projection?.visibleSnapshot(),
    sessionState = source.sessionState();
  const turns =
    active && !input.cursor
      ? [...page.turns.filter((turn) => turn.id !== active.id), active]
      : page.turns;
  const snapshot: AgentProviderTaskSnapshot = {
    runtime: "acp",
    ...(sessionState ? { acpSession: sessionState } : {}),
    ...localTaskMetadata(task),
    engine: source.engine,
    status:
      active?.status === "running" ? "running" : active?.status === "failed" ? "failed" : "idle",
    turns,
    turnsNextCursor: page.cursor,
    contextUsage: source.contextUsage(),
    goal: null,
    plan: projection?.plan ?? null,
    pendingRequests: source.pending(),
  };
  input.snapshotRead?.capture(snapshot);
  return snapshot;
}
