import { RequestError } from "@agentclientprotocol/sdk";
import {
  localTaskMetadata,
  type LocalTask,
  type ReadAgentTaskInput,
  type AgentProviderTaskSnapshot,
} from "@codexly/core";
import type { AgentEngine } from "@codexly/protocol";
import type { AcpSessionState } from "@codexly/protocol";
import { AcpHistoryCorruptionError, type AcpHistory } from "./history.js";
import type { AcpConnection } from "./connection.js";
import type { AcpEventProjection } from "./event-projection.js";
import type { AcpSubagentBackground } from "./subagent-background.js";

/** 异步历史准备完成后同步读取活动投影并捕获边界，不在正文与 checkpoint 之间 await。 */
export async function readAcpTaskSnapshot(
  task: LocalTask,
  input: ReadAgentTaskInput,
  source: {
    engine: AgentEngine;
    history: AcpHistory;
    load(repairHistory?: boolean): Promise<unknown>;
    active(): AcpEventProjection | undefined;
    background?: AcpSubagentBackground;
    needsReplay?(): Promise<boolean>;
    pending(): AgentProviderTaskSnapshot["pendingRequests"];
    contextUsage(): AgentProviderTaskSnapshot["contextUsage"];
    sessionState(): AcpSessionState | undefined;
  },
): Promise<AgentProviderTaskSnapshot> {
  const previous = source.active();
  const previousBackground = source.background?.revision;
  let external = false;
  const load = async (repairHistory = false) => {
    try {
      await source.load(repairHistory);
      return true;
    } catch (error) {
      const data =
        error instanceof RequestError
          ? (error.data as { reason?: unknown; threadId?: unknown } | null)
          : null;
      // 仅匹配当前会话的 ACP 占用错误，继续展示最后一次提交的本地历史。
      if (
        task.provider !== "codex" ||
        !(error instanceof RequestError) ||
        error.code !== -32600 ||
        data?.reason !== "thread_active_writer" ||
        data.threadId !== task.sessionId
      )
        throw error;
      return false;
    }
  };
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
    // 缓存已损坏且 ACP 无法回放，保留原始错误，避免把损坏投影显示为空历史。
    if (!(await load(true))) throw error;
    return null;
  });
  if (page === null) page = await source.history.read(task.id);
  else if (!input.cursor && !previous && task.sessionId) {
    const recover = await source.needsReplay?.();
    if (recover) {
      // 只通过原会话补齐历史。流尚未完整时保留最近一次成功保存的本地快照。
      input.signal?.throwIfAborted();
      const recovered = await load(true).catch(() => undefined);
      external = recovered === false;
      if (recovered) page = await source.history.read(task.id);
    } else if (
      page.turns.length === 0 ||
      (task.provider === "codex" && input.checkWriteAccess === true)
    ) {
      external = !(await load());
      if (!external) page = await source.history.read(task.id);
    }
  }
  // 读旧游标期间，历史提交可能刚好移除活动投影；重新读一次才可捕获新 checkpoint。
  if (
    !input.cursor &&
    ((previous && previous !== source.active()) ||
      previousBackground !== source.background?.revision)
  )
    page = await source.history.read(task.id);
  input.signal?.throwIfAborted();
  const projection = source.active(),
    active = projection?.visibleSnapshot(),
    sessionState = source.sessionState();
  const background = input.cursor ? [] : (source.background?.snapshots(task.id) ?? []);
  const live = [...background, ...(active && !input.cursor ? [active] : [])];
  const liveIds = new Set(live.map((turn) => turn.id));
  const turns = live.length
    ? [...page.turns.filter((turn) => !liveIds.has(turn.id)), ...live]
    : page.turns;
  const snapshot: AgentProviderTaskSnapshot = {
    runtime: "acp",
    ...(external
      ? { writeAccess: "external" as const }
      : input.checkWriteAccess && task.provider === "codex"
        ? { writeAccess: "writable" as const }
        : {}),
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

/** 未绑定的会话没有原生配置元数据，不能补造默认值。 */
export function readAcpTaskSessionState(
  connection: AcpConnection | undefined,
  sessions: ReadonlyMap<string, string>,
  id: string,
) {
  const session = sessions.get(id);
  return session ? connection?.readSessionState(session) : undefined;
}
