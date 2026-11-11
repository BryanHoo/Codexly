import {
  localTaskMetadata,
  type LocalTask,
  type ReadAgentTaskInput,
  type AgentProviderTaskSnapshot,
} from "@codexly/core";
import type { AgentEngine } from "@codexly/protocol";
import type { AcpSessionState } from "@codexly/protocol";
import type { AcpHistory } from "./history.js";
import type { AcpEventProjection } from "./event-projection.js";

/** 异步历史准备完成后同步读取活动投影并捕获边界，不在正文与 checkpoint 之间 await。 */
export async function readAcpTaskSnapshot(
  task: LocalTask,
  input: ReadAgentTaskInput,
  source: {
    engine: AgentEngine;
    history: AcpHistory;
    load(): Promise<unknown>;
    active(): AcpEventProjection | undefined;
    pending(): AgentProviderTaskSnapshot["pendingRequests"];
    sessionState(): AcpSessionState | undefined;
  },
): Promise<AgentProviderTaskSnapshot> {
  let page = await source.history.read(task.id, input.cursor);
  if (!input.cursor && task.sessionId && page.turns.length === 0) {
    await source.load();
    page = await source.history.read(task.id);
  }
  input.signal?.throwIfAborted();
  const projection = source.active(),
    active = projection?.snapshot(),
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
    status: active?.status === "running" ? "running" : "idle",
    turns,
    turnsNextCursor: page.cursor,
    contextUsage: null,
    goal: null,
    plan: projection?.plan ?? null,
    pendingRequests: source.pending(),
  };
  input.snapshotRead?.capture(snapshot);
  return snapshot;
}
